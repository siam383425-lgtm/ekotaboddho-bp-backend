// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  fatherName: { type: String },
  address: { type: String },
  bloodGroup: { type: String },
  password: { type: String, required: true },

  // মেম্বারশিপ স্ট্যাটাস ও অটো-জেনারেটেড আইডি
  memberId: { type: String, default: 'Pending' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },

  // প্রোফাইল পিকচার (ক্লাউডিনারি লিংক)
  photoUrl: { type: String, default: '' },

  // ক্রেডিট / পয়েন্ট
  credits: { type: Number, default: 0 },

  // পুশ নোটিফিকেশন টোকেন
  pushToken: { type: String, default: null },

  // যোগদানের তারিখ
  joinDate: { type: Date, default: Date.now }
});

// ✅ পাসওয়ার্ড সেভ করার আগে bcrypt দিয়ে হ্যাশ করা
userSchema.pre('save', async function (next) {
  // যদি পাসওয়ার্ড পরিবর্তন না হয়, তাহলে হ্যাশ করব না
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.model('User', userSchema);
