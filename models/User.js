// models/User.js
const mongoose = require('mongoose');

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

  // ক্রেডিট / পয়েন্ট (মিশন ইত্যাদির জন্য)
  credits: { type: Number, default: 0 },

  // যোগদানের তারিখ
  joinDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
pushToken: { type: String, default: null },
