const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Authentication
  email: { 
    type: String, 
    unique: true, 
    required: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  password: { type: String, required: true },
  
  // Personal Info
  firstName: { 
    type: String, 
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50
  },
  lastName: { 
    type: String, 
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50
  },
  preferredName: { 
    type: String, 
    trim: true,
    maxlength: 50
  },
  dob: { 
    type: Date, 
    required: true
  },
  phone: { 
    type: String,
    match: [/^\([0-9]{3}\) [0-9]{3}-[0-9]{4}$/, 'Please enter a valid phone number']
  },
  
  // Shipping Address (for Stripe and orders)
  unitNumber: { 
    type: String,
    trim: true,
    maxlength: 20
  },
  street: { 
    type: String, 
    required: true,
    trim: true,
    minlength: 5,
    maxlength: 100
  },
  city: { 
    type: String, 
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50
  },
  province: { 
    type: String, 
    required: true,
    enum: ['AB', 'BC', 'MB', 'NB', 'NL', 'NT', 'NS', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'],
    uppercase: true
  },
  postalCode: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    match: [/^[A-Z]\d[A-Z] \d[A-Z]\d$/, 'Please enter a valid postal code']
  },
  country: { 
    type: String, 
    required: true,
    default: 'CA',
    enum: ['CA']
  },
  
  // Stripe Integration
  stripeCustomerId: { 
    type: String, 
    unique: true, 
    sparse: true 
  },
  stripeDefaultPaymentMethodId: String,
  
  // Billing Address (optional, defaults to shipping)
  billingSameAsShipping: { 
    type: Boolean, 
    default: true 
  },
  billingUnitNumber: String,
  billingStreet: String,
  billingCity: String,
  billingProvince: String,
  billingPostalCode: String,
  billingCountry: { 
    type: String, 
    default: 'CA' 
  },
  
  // Subscription Info
  stripeSubscriptionId: String,
  subscriptionStatus: { 
    type: String, 
    enum: ['active', 'canceled', 'past_due', 'unpaid', 'trialing', 'none'],
    default: 'none'
  },
  currentPlan: String,
  
  // Tax Info (for Canadian businesses)
  taxId: String, // GST/HST number
  taxExempt: { 
    type: String, 
    enum: ['none', 'exempt', 'reverse'], 
    default: 'none' 
  },
  companyName: String,
  
  // Account Status
  emailVerified: { 
    type: Boolean, 
    default: false 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  
  // Timestamps
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  },
  lastLogin: Date,
  emailVerifiedAt: Date,
  
  // Payment History
  lastPaymentDate: Date,
  nextPaymentDate: Date,
  
  // Security
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  emailVerificationToken: String,
  emailVerificationExpires: Date
}, {
  timestamps: true // Automatically manages createdAt and updatedAt
});

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ stripeCustomerId: 1 });
userSchema.index({ createdAt: 1 });
userSchema.index({ emailVerified: 1 });

// Method to get full address
userSchema.methods.getShippingAddress = function() {
  return {
    unitNumber: this.unitNumber,
    street: this.street,
    city: this.city,
    province: this.province,
    postalCode: this.postalCode,
    country: this.country
  };
};

// Method to get billing address
userSchema.methods.getBillingAddress = function() {
  if (this.billingSameAsShipping) {
    return this.getShippingAddress();
  }
  return {
    unitNumber: this.billingUnitNumber,
    street: this.billingStreet,
    city: this.billingCity,
    province: this.billingProvince,
    postalCode: this.billingPostalCode,
    country: this.billingCountry
  };
};

// Pre-save middleware to update timestamps
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('User', userSchema);