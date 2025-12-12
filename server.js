const express = require('express');
const stripe = require('stripe')('sk_test_51RBK5OKX1QJsog5p98IVEmFvCJfpCyUfqOY4EO34NY5P3teT3GOa3ynnvjzW0b69p6TcIpzMm1L9HtJXym8Pc38y00NvVrLKOS');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');


const app = express();
const port = 4242;

// MongoDB Connection
mongoose.connect('mongodb://127.0.0.1:27017/books2digital', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.error('MongoDB connection error:', err));

// User Model
const UserSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String },
  stripeCustomerId: { type: String } // Added for Stripe integration
});

const User = mongoose.model('User', UserSchema);

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:5500'], // Add your frontend origins
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'your-secret-key-here',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Authentication Middleware
function isLoggedIn(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Stripe Payment Endpoint (Protected)
app.post('/create-payment-intent', isLoggedIn, async (req, res) => {
  try {
    const { amount, currency, customerEmail, orderData } = req.body;

    if (!amount || isNaN(amount)) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Get user from session
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create or retrieve Stripe customer
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        phone: user.phone,
        metadata: {
          userId: user._id.toString(),
          localCustomerEmail: user.email
        }
      });
      stripeCustomerId = customer.id;
      user.stripeCustomerId = stripeCustomerId;
      await user.save();
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: currency || 'cad',
      customer: stripeCustomerId,
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId: user._id.toString(),
        ...orderData
      },
    });

    res.json({ 
      clientSecret: paymentIntent.client_secret,
      customerId: stripeCustomerId
    });
    
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ 
      error: 'Payment processing failed',
      details: error.message 
    });
  }
});

// Signup Route
app.post('/signup', async (req, res) => {
  try {
    const { first_name, last_name, email, password, phone } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      firstName: first_name,
      lastName: last_name,
      email,
      password: hashedPassword,
      phone
    });

    req.session.userId = newUser._id;
    res.status(201).json({ 
      success: true, 
      redirectUrl: '/HTML,%20CSS,%20JavaScript/pages/login_page.html' 
    });
    
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ 
      error: 'Registration failed',
      details: error.message 
    });
  }
});

// Login Route
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId = user._id;
    res.json({ 
      success: true, 
      redirectUrl: '/HTML,%20CSS,%20JavaScript/pages/profile_page.html' 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout Route
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, redirectUrl: '/HTML,%20CSS,%20JavaScript/pages/login_page.html' });
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});