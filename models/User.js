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

  memberId: { type: String, default: 'Pending' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },

  photoUrl: { type: String, default: '' },
  credits: { type: Number, default: 0 },
  pushToken: { type: String, default: null },

  resetCode: { type: String, default: null },
  resetCodeExpires: { type: Date, default: null },

  joinDate: { type: Date, default: Date.now }
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.model('User', userSchema);
