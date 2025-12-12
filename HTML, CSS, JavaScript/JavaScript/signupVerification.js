const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const StripeService = require('../services/stripeService');
const router = express.Router();

// In-memory store for pending registrations (use Redis in production)
const pendingRegistrations = new Map();

// Email transporter
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Cleanup expired registrations every minute
setInterval(() => {
  const now = Date.now();
  for (const [tempUserId, data] of pendingRegistrations.entries()) {
    if (now - data.createdAt > 10 * 60 * 1000) { // 10 minutes
      pendingRegistrations.delete(tempUserId);
      console.log(`Cleaned up expired registration: ${tempUserId}`);
    }
  }
}, 60000);

// 1. INITIATE SIGNUP
router.post('/initiate', async (req, res) => {
  try {
    const userData = req.body;

    // Validate required fields
    const requiredFields = ['email', 'password', 'firstName', 'lastName', 'dob', 'street', 'city', 'province', 'postalCode'];
    for (const field of requiredFields) {
      if (!userData[field]) {
        return res.status(400).json({ 
          error: `Missing required field: ${field}` 
        });
      }
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: userData.email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ 
        error: 'Email already registered. Please log in or use a different email.' 
      });
    }

    // Validate password strength
    if (userData.password.length < 8) {
      return res.status(400).json({ 
        error: 'Password must be at least 8 characters long' 
      });
    }

    // Validate age (13+)
    const dob = new Date(userData.dob);
    const today = new Date();
    const minAgeDate = new Date(today.getFullYear() - 13, today.getMonth(), today.getDate());
    if (dob > minAgeDate) {
      return res.status(400).json({ 
        error: 'You must be at least 13 years old to register' 
      });
    }

    // Validate postal code format
    const postalCodeRegex = /^[A-Z]\d[A-Z] \d[A-Z]\d$/;
    if (!postalCodeRegex.test(userData.postalCode)) {
      return res.status(400).json({ 
        error: 'Please enter a valid postal code (e.g., A1A 1A1)' 
      });
    }

    // Generate temporary ID and verification code
    const tempUserId = crypto.randomBytes(16).toString('hex');
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash password
    const hashedPassword = await bcrypt.hash(userData.password, 10);

    // Store pending registration
    pendingRegistrations.set(tempUserId, {
      ...userData,
      password: hashedPassword,
      email: userData.email.toLowerCase(),
      verificationCode,
      createdAt: Date.now(),
      verificationAttempts: 0
    });

    // Send verification email
    await sendVerificationEmail(
      userData.email,
      verificationCode,
      userData.firstName
    );

    res.json({
      success: true,
      tempUserId,
      message: 'Verification code sent to your email'
    });

  } catch (error) {
    console.error('Signup initiation error:', error);
    res.status(500).json({ 
      error: 'Failed to initiate signup. Please try again.' 
    });
  }
});

// 2. VERIFY EMAIL AND CREATE USER
router.post('/verify', async (req, res) => {
  try {
    const { tempUserId, verificationCode } = req.body;

    // Validate input
    if (!tempUserId || !verificationCode) {
      return res.status(400).json({ 
        error: 'Missing verification data' 
      });
    }

    // Check if registration exists
    const registration = pendingRegistrations.get(tempUserId);
    if (!registration) {
      return res.status(400).json({ 
        error: 'Registration expired or invalid. Please start again.' 
      });
    }

    // Check if verification code matches
    if (registration.verificationCode !== verificationCode) {
      registration.verificationAttempts++;
      
      if (registration.verificationAttempts >= 5) {
        pendingRegistrations.delete(tempUserId);
        return res.status(400).json({ 
          error: 'Too many failed attempts. Please restart registration.' 
        });
      }
      
      return res.status(400).json({ 
        error: 'Invalid verification code. Please try again.' 
      });
    }

    // Check if code is expired (10 minutes)
    if (Date.now() - registration.createdAt > 10 * 60 * 1000) {
      pendingRegistrations.delete(tempUserId);
      return res.status(400).json({ 
        error: 'Verification code expired. Please request a new one.' 
      });
    }

    // Create user in database
    const userData = {
      email: registration.email,
      password: registration.password,
      firstName: registration.firstName,
      lastName: registration.lastName,
      preferredName: registration.preferredName || null,
      dob: registration.dob,
      phone: registration.phone || null,
      unitNumber: registration.unitNumber || null,
      street: registration.street,
      city: registration.city,
      province: registration.province,
      postalCode: registration.postalCode,
      country: registration.country || 'CA',
      emailVerified: true,
      emailVerifiedAt: new Date()
    };

    const newUser = new User(userData);
    await newUser.save();

    // Create Stripe customer (async, don't block signup)
    try {
      const stripeCustomer = await StripeService.createCustomer(newUser);
      newUser.stripeCustomerId = stripeCustomer.id;
      await newUser.save();
    } catch (stripeError) {
      console.error('Stripe customer creation failed:', stripeError);
      // Continue without failing signup - user can add payment later
    }

    // Remove from pending registrations
    pendingRegistrations.delete(tempUserId);

    // Create session/token (use your existing auth method)
    const token = generateAuthToken(newUser);

    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'strict'
    });

    res.json({
      success: true,
      user: {
        id: newUser._id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName
      },
      token,
      redirectUrl: '/profile'
    });

  } catch (error) {
    console.error('Verification error:', error);
    
    if (error.code === 11000) { // Duplicate key error
      return res.status(400).json({ 
        error: 'Email already registered. Please log in.' 
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to verify email. Please try again.' 
    });
  }
});

// 3. RESEND VERIFICATION CODE
router.post('/resend-code', async (req, res) => {
  try {
    const { tempUserId } = req.body;

    if (!tempUserId) {
      return res.status(400).json({ 
        error: 'Invalid request' 
      });
    }

    const registration = pendingRegistrations.get(tempUserId);
    if (!registration) {
      return res.status(400).json({ 
        error: 'Registration expired. Please start again.' 
      });
    }

    // Generate new code
    const newVerificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Update registration
    registration.verificationCode = newVerificationCode;
    registration.createdAt = Date.now();
    registration.verificationAttempts = 0;

    // Send new email
    await sendVerificationEmail(
      registration.email,
      newVerificationCode,
      registration.firstName
    );

    res.json({ 
      success: true, 
      message: 'New verification code sent!' 
    });

  } catch (error) {
    console.error('Resend code error:', error);
    res.status(500).json({ 
      error: 'Failed to resend code. Please try again.' 
    });
  }
});

// 4. CHECK VERIFICATION STATUS
router.get('/status/:tempUserId', (req, res) => {
  const { tempUserId } = req.params;
  
  const registration = pendingRegistrations.get(tempUserId);
  if (!registration) {
    return res.status(404).json({ 
      error: 'Registration not found' 
    });
  }

  const timeRemaining = 10 * 60 * 1000 - (Date.now() - registration.createdAt);
  const minutes = Math.floor(timeRemaining / 60000);
  const seconds = Math.floor((timeRemaining % 60000) / 1000);

  res.json({
    exists: true,
    email: registration.email,
    timeRemaining: `${minutes}:${seconds.toString().padStart(2, '0')}`,
    attempts: registration.verificationAttempts
  });
});

// HELPER FUNCTIONS
async function sendVerificationEmail(email, code, firstName) {
  const mailOptions = {
    from: `Books2Digital <${process.env.EMAIL_FROM || 'noreply@books2digital.com'}>`,
    to: email,
    subject: 'Verify Your Email - Books2Digital',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #3498db, #2c3e50); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">📚 Books2Digital</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">The Lowest Price & The Highest Quality</p>
        </div>
        
        <div style="padding: 40px; background: white; border: 1px solid #ddd; border-top: none; border-radius: 0 0 10px 10px;">
          <h2 style="color: #2c3e50; margin-top: 0;">Hello ${firstName}!</h2>
          
          <p>Thank you for creating an account with Books2Digital. To complete your registration, please use the verification code below:</p>
          
          <div style="text-align: center; margin: 40px 0;">
            <div style="display: inline-block; background: #f8f9fa; padding: 25px 40px; border-radius: 8px; border: 2px dashed #3498db;">
              <div style="font-size: 14px; color: #7f8c8d; margin-bottom: 10px; letter-spacing: 2px;">VERIFICATION CODE</div>
              <div style="font-size: 42px; font-weight: bold; letter-spacing: 15px; color: #2c3e50; font-family: 'Courier New', monospace;">
                ${code}
              </div>
            </div>
          </div>
          
          <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
            <strong>⏰ This code expires in 10 minutes</strong>
            <p style="margin: 5px 0 0 0; font-size: 14px;">
              Expires at: ${new Date(Date.now() + 10*60000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </p>
          </div>
          
          <p>If you didn't create an account with Books2Digital, please ignore this email.</p>
          
          <p style="margin-top: 40px;">Happy reading!</p>
          <p><strong>The Books2Digital Team</strong></p>
        </div>
        
        <div style="text-align: center; margin-top: 20px; color: #95a5a6; font-size: 12px;">
          <p>© ${new Date().getFullYear()} Books2Digital. All rights reserved.</p>
          <p>123 Book Street, Toronto, ON M5V 2T6, Canada</p>
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

function generateAuthToken(user) {
  // Implement your JWT or session token generation
  // Example with JWT:
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { 
      userId: user._id,
      email: user.email 
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = router;