// server.js (সম্পূর্ণ – tokenVersion, 2FA, পেন্ডিং রেজিস্ট্রেশন, নোটিশ, পুশ, ব্র্যান্ডিং: একতাবদ্ধ বি.পি)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const http = require('http');
const { Server } = require('socket.io');
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
app.use(cors());
app.use(express.json({ limit: '50mb' }));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ ডাটাবেস সফলভাবে কানেক্ট হয়েছে!'))
  .catch((err) => console.log('❌ ডাটাবেস কানেকশন এরর: ', err));

// -------------------- verifyToken মিডলওয়্যার (tokenVersion চেক) --------------------
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'অনুগ্রহ করে লগইন করুন' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('tokenVersion');
    if (!user) return res.status(401).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });
    if (user.tokenVersion !== decoded.version) {
      return res.status(401).json({ success: false, message: 'অন্য ডিভাইসে লগইন হয়েছে। পুনরায় লগইন করুন।' });
    }
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'টোকেন অবৈধ বা মেয়াদ উত্তীর্ণ' });
  }
};

// -------------------- মডেলস --------------------
const User = require('./models/User');

const ChatSchema = new mongoose.Schema({
  sender: String, text: String, time: String,
  type: { type: String, default: 'text' }, audioUri: String,
  isAdmin: { type: Boolean, default: false }, timestamp: { type: Date, default: Date.now },
});
const Chat = mongoose.model('Chat', ChatSchema);

const GallerySchema = new mongoose.Schema({
  imageUrl: String, title: String, category: String, date: { type: Date, default: Date.now },
});
const Gallery = mongoose.model('Gallery', GallerySchema);

const FundSchema = new mongoose.Schema({
  totalAmount: { type: Number, default: 0 }, lastUpdated: { type: Date, default: Date.now },
});
const Fund = mongoose.model('Fund', FundSchema);

const NoticeSchema = new mongoose.Schema({
  title: String, description: String, date: { type: Date, default: Date.now },
});
const Notice = mongoose.model('Notice', NoticeSchema);

const PollSchema = new mongoose.Schema({
  question: String, options: [{ text: String, votes: { type: Number, default: 0 } }],
  votedUsers: [String], isActive: { type: Boolean, default: true },
});
const Poll = mongoose.model('Poll', PollSchema);

const EventSchema = new mongoose.Schema({
  title: String, date: Date, description: String, location: String,
});
const Event = mongoose.model('Event', EventSchema);

const MissionSchema = new mongoose.Schema({
  title: String, description: String, progress: { type: Number, default: 0 },
  color: String, icon: String, status: { type: String, default: 'সক্রিয়' },
  albumPhotos: [String], isCompleted: { type: Boolean, default: false },
  hashtag: { type: String, default: '#abidarpara_club' }, verifiedBy: [String],
});
const Mission = mongoose.model('Mission', MissionSchema);

// -------------------- ইমেইল ট্রান্সপোর্টার (ব্র্যান্ডিং: একতাবদ্ধ বি.পি) --------------------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const mailBase = (bodyHtml) => `
  <div style="max-width: 600px; margin: auto; padding: 20px; background: #f4f6f8; border-radius: 12px; font-family: 'Segoe UI', Tahoma, sans-serif;">
    <div style="text-align: center; margin-bottom: 20px;">
      <h2 style="color: #00adb5; margin: 0;">একতাবদ্ধ বি.পি</h2>
      <p style="color: #666; font-size: 14px;">আবিদার পাড়া ক্লাব</p>
    </div>
    <div style="background: white; padding: 25px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">
      ${bodyHtml}
    </div>
    <p style="text-align: center; font-size: 11px; color: #bbb; margin-top: 15px;">© 2026 একতাবদ্ধ বি.পি। সর্বস্বত্ব সংরক্ষিত।</p>
  </div>`;

// -------------------- Google Drive --------------------
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  scopes: ['https://www.googleapis.com/auth/drive.file'],
});
const drive = google.drive({ version: 'v3', auth });

// ===================================================================
//                           API রুট
// ===================================================================

// ১. ইমেজ আপলোড
app.post('/api/upload', async (req, res) => {
  try {
    const fileStr = req.body.data;
    const uploadResponse = await cloudinary.uploader.upload(fileStr, { upload_preset: 'ml_default' });
    res.json({ success: true, url: uploadResponse.secure_url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'আপলোড ব্যর্থ হয়েছে!' });
  }
});

// ২. প্রোফাইল ছবি
app.post('/api/users/profile-picture', verifyToken, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ success: false, message: 'ছবি প্রদান করুন' });
    const uploadResponse = await cloudinary.uploader.upload(image, {
      folder: 'profile_pictures',
      public_id: `user_${req.userId}_${Date.now()}`,
      transformation: [{ width: 300, height: 300, crop: 'fill', gravity: 'face' }],
    });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });
    user.photoUrl = uploadResponse.secure_url;
    await user.save();
    res.json({ success: true, photoUrl: uploadResponse.secure_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'আপলোড ব্যর্থ' });
  }
});

// ৩. রেজিস্ট্রেশন (পেন্ডিং, টোকেন ছাড়া)
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone, fatherName, address, bloodGroup, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ success: false, message: 'ইমেইলটি আগেই ব্যবহৃত হয়েছে!' });

    const newUser = new User({ name, email, phone, fatherName, address, bloodGroup, password });
    await newUser.save();

    // পেন্ডিং ইমেইল
    transporter.sendMail({
      from: `"একতাবদ্ধ বি.পি" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '🎉 আপনার রেজিস্ট্রেশন গৃহীত হয়েছে',
      html: mailBase(`<h3 style="color: #333;">প্রিয় ${name},</h3>
        <p style="color: #555; line-height: 1.6;">আপনার রেজিস্ট্রেশন সফলভাবে জমা হয়েছে। 🎉</p>
        <p style="color: #555; line-height: 1.6;">অ্যাডমিন আপনার আবেদন পর্যালোচনা করে দ্রুত অনুমোদন দেবেন। তারপর আপনি লগইন করতে পারবেন।</p>
        <p style="color: #888;">ধন্যবাদ!</p>`),
    });

    res.status(201).json({ success: true, message: 'রেজিস্ট্রেশন সফল! অ্যাডমিনের অনুমোদনের জন্য অপেক্ষা করুন।' });
  } catch (err) { res.status(500).json({ success: false, message: 'সার্ভার এরর!' }); }
});

// ৪. লগইন (tokenVersion + 2FA)
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ success: false, message: 'ভুল ইমেইল বা পাসওয়ার্ড!' });
    if (user.status === 'pending')
      return res.status(403).json({ success: false, message: 'অ্যাকাউন্ট এখনো পেন্ডিং।' });

    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    const token = jwt.sign(
      { id: user._id, email: user.email, version: user.tokenVersion },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    if (user.twoFactorEnabled) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const tempToken = crypto.randomBytes(16).toString('hex');
      user.twoFactorCode = otp;
      user.twoFactorCodeExpires = new Date(Date.now() + 2 * 60 * 1000);
      user.twoFactorToken = tempToken;
      await user.save();

      transporter.sendMail({
        from: `"একতাবদ্ধ বি.পি" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '🔐 লগইন OTP',
        html: mailBase(`<h3>আপনার লগইন OTP</h3>
          <div style="background: #00adb5; color: white; padding: 20px; border-radius: 10px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; margin: 20px 0;">${otp}</div>
          <p style="color: #888;">এই OTP ২ মিনিটের মধ্যে ব্যবহার করুন।</p>`),
      });

      return res.json({ success: true, requires2FA: true, tempToken });
    }

    res.json({ success: true, user, token });
  } catch (err) { res.status(500).json({ success: false, message: 'সার্ভার এরর!' }); }
});

// ৫. 2FA OTP যাচাই (লগইনের জন্য)
app.post('/api/verify-2fa', async (req, res) => {
  try {
    const { tempToken, otp } = req.body;
    if (!tempToken || !otp) return res.status(400).json({ success: false, message: 'প্রয়োজনীয় তথ্য প্রদান করুন' });
    const user = await User.findOne({ twoFactorToken: tempToken });
    if (!user) return res.status(400).json({ success: false, message: 'অবৈধ সেশন' });
    if (new Date() > user.twoFactorCodeExpires) return res.status(400).json({ success: false, message: 'OTP-র মেয়াদ শেষ' });
    if (user.twoFactorCode !== otp.trim()) return res.status(400).json({ success: false, message: 'OTP ভুল' });

    user.twoFactorCode = undefined;
    user.twoFactorCodeExpires = undefined;
    user.twoFactorToken = undefined;
    await user.save();

    const token = jwt.sign(
      { id: user._id, email: user.email, version: user.tokenVersion },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ success: true, user, token });
  } catch (err) { res.status(500).json({ success: false, message: 'সার্ভার এরর' }); }
});

// ৬. 2FA সক্রিয়করণ OTP পাঠানো
app.post('/api/users/2fa/request', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });
    if (user.twoFactorEnabled) return res.status(400).json({ success: false, message: '2FA ইতিমধ্যে চালু আছে' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.twoFactorCode = otp;
    user.twoFactorCodeExpires = new Date(Date.now() + 2 * 60 * 1000);
    await user.save();

    transporter.sendMail({
      from: `"একতাবদ্ধ বি.পি" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: '🔐 2FA সক্রিয়করণ OTP',
      html: mailBase(`<h3>2FA সক্রিয়করণ OTP</h3>
        <div style="background: #00adb5; color: white; padding: 20px; border-radius: 10px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; margin: 20px 0;">${otp}</div>
        <p style="color: #888;">এই OTP ২ মিনিটের মধ্যে ব্যবহার করুন।</p>`),
    });

    res.json({ success: true, message: 'OTP ইমেইলে পাঠানো হয়েছে' });
  } catch (err) { res.status(500).json({ success: false, message: 'সার্ভার এরর' }); }
});

// ৭. 2FA সক্রিয়করণ OTP যাচাই
app.post('/api/users/2fa/verify', verifyToken, async (req, res) => {
  try {
    const { otp } = req.body;
    const user = await User.findById(req.userId);
    if (!user || !user.twoFactorCode || !user.twoFactorCodeExpires)
      return res.status(400).json({ success: false, message: 'OTP পাওয়া যায়নি' });
    if (new Date() > user.twoFactorCodeExpires)
      return res.status(400).json({ success: false, message: 'OTP-র মেয়াদ শেষ' });
    if (user.twoFactorCode !== otp.trim())
      return res.status(400).json({ success: false, message: 'OTP ভুল' });

    user.twoFactorEnabled = true;
    user.twoFactorCode = undefined;
    user.twoFactorCodeExpires = undefined;
    await user.save();
    res.json({ success: true, twoFactorEnabled: true, message: '2FA সফলভাবে চালু হয়েছে' });
  } catch (err) { res.status(500).json({ success: false, message: 'সার্ভার এরর' }); }
});

// ৮. 2FA বন্ধ
app.put('/api/users/2fa/disable', verifyToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.userId, { twoFactorEnabled: false });
    res.json({ success: true, twoFactorEnabled: false, message: '2FA বন্ধ করা হয়েছে' });
  } catch (err) { res.status(500).json({ success: false, message: 'সার্ভার এরর' }); }
});

// ৯. মেম্বারশিপ ম্যানেজমেন্ট
app.put('/api/approve/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি!' });
    const lastUser = await User.findOne({ status: 'approved' }).sort({ memberId: -1 });
    let newId = 'BP-101';
    if (lastUser && lastUser.memberId && lastUser.memberId.startsWith('BP-')) {
      const lastNum = parseInt(lastUser.memberId.split('-')[1]);
      newId = `BP-${lastNum + 1}`;
    }
    user.status = 'approved';
    user.memberId = newId;
    await user.save();

    transporter.sendMail({
      from: `"একতাবদ্ধ বি.পি" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: '✅ আপনার মেম্বারশিপ অনুমোদিত হয়েছে!',
      html: mailBase(`<h3 style="color: #333;">অভিনন্দন, ${user.name}! 🎊</h3>
        <p style="color: #555;">আপনার মেম্বারশিপ অনুমোদিত হয়েছে।</p>
        <div style="background: #00adb5; color: white; padding: 15px 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; font-size: 24px; font-weight: bold;">আইডি: ${newId}</p>
        </div>`),
    });

    res.json({ success: true, memberId: newId });
  } catch (err) { res.status(500).json({ success: false, message: 'এরর!' }); }
});

app.get('/api/users/pending', async (req, res) => {
  const users = await User.find({ status: 'pending' }).sort({ _id: -1 });
  res.json({ success: true, users });
});

app.get('/api/users/approved', async (req, res) => {
  const users = await User.find({ status: 'approved' }).sort({ memberId: 1 });
  res.json({ success: true, users });
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'বাতিল করা হয়েছে' });
  } catch (error) { res.json({ success: false, message: 'ডিলিট করতে সমস্যা হয়েছে' }); }
});

// ১০. প্রোফাইল আপডেট
app.put('/api/users/update/:id', verifyToken, async (req, res) => {
  try {
    const { name, phone, address, bloodGroup, fatherName } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });
    if (req.userId !== user._id.toString()) return res.status(403).json({ success: false, message: 'অনুমতি নেই' });
    user.name = name || user.name;
    user.phone = phone || user.phone;
    user.address = address || user.address;
    user.bloodGroup = bloodGroup || user.bloodGroup;
    user.fatherName = fatherName || user.fatherName;
    await user.save();
    res.json({ success: true, message: 'প্রোফাইল আপডেট হয়েছে' });
  } catch (err) { res.status(500).json({ success: false, message: 'সার্ভার এরর' }); }
});

// ১১. পাসওয়ার্ড পরিবর্তন
app.put('/api/users/change-password', verifyToken, async (req, res) => {
  try {
    const { userId, oldPassword, newPassword } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });
    if (req.userId !== user._id.toString()) return res.status(403).json({ success: false, message: 'অনুমতি নেই' });
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) return res.status(400).json({ success: false, message: 'পুরনো পাসওয়ার্ড ভুল' });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'পাসওয়ার্ড পরিবর্তন হয়েছে' });
  } catch (err) { res.status(500).json({ success: false, message: 'সার্ভার এরর' }); }
});

// ১২. ইউজার স্ট্যাট
app.get('/api/users/stats', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });
    res.json({ success: true, missions: 0, events: 0, points: user.credits || 0 });
  } catch (err) { res.status(500).json({ success: false, message: 'এরর' }); }
});

// ১৩. চ্যাট
app.get('/api/chat/messages', verifyToken, async (req, res) => {
  const messages = await Chat.find().sort({ timestamp: 1 }).limit(100);
  res.json({ success: true, messages });
});

app.post('/api/chat/send', verifyToken, async (req, res) => {
  try {
    const { text } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });
    const chatMsg = new Chat({ sender: user.name, text, timestamp: new Date() });
    await chatMsg.save();
    res.json({ success: true, message: 'পাঠানো হয়েছে' });
  } catch (err) { res.status(500).json({ success: false, message: 'সার্ভার এরর' }); }
});

const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
io.on('connection', (socket) => {
  console.log('একজন মেম্বার কানেক্ট হয়েছেন');
  socket.on('fetch_messages', async () => {
    const messages = await Chat.find().sort({ timestamp: 1 }).limit(100);
    socket.emit('load_messages', messages);
  });
  socket.on('send_message', async (data) => {
    const chatMsg = new Chat(data);
    await chatMsg.save();
    io.emit('receive_message', data);
  });
  socket.on('disconnect', () => console.log('মেম্বার ডিসকানেক্ট হয়েছেন'));
});

// ১৪. অ্যালবাম
app.get('/api/albums/photos', verifyToken, async (req, res) => {
  const images = await Gallery.find().sort({ date: -1 });
  res.json({ success: true, photos: images.map(img => ({ _id: img._id, url: img.imageUrl, caption: img.title })) });
});

app.get('/api/missions/:missionId/photos', verifyToken, async (req, res) => {
  const mission = await Mission.findById(req.params.missionId);
  if (!mission) return res.status(404).json({ success: false, message: 'মিশন পাওয়া যায়নি' });
  const photos = mission.albumPhotos.map((url, idx) => ({ _id: `m_${idx}`, url, caption: mission.title }));
  res.json({ success: true, photos });
});

app.post('/api/gallery/add', async (req, res) => {
  await new Gallery(req.body).save();
  res.json({ success: true });
});

app.delete('/api/gallery/:id', verifyToken, async (req, res) => {
  await Gallery.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'ছবি মুছে ফেলা হয়েছে' });
});

// ১৫. ফান্ড
app.get('/api/fund', async (req, res) => {
  let fund = await Fund.findOne();
  if (!fund) fund = await Fund.create({ totalAmount: 0 });
  res.json(fund);
});

app.post('/api/fund/update', async (req, res) => {
  let fund = await Fund.findOne();
  if (!fund) fund = new Fund({ totalAmount: Number(req.body.amount) });
  else fund.totalAmount += Number(req.body.amount);
  await fund.save();
  res.json({ success: true });
});

// ১৬. নোটিশ (পেজিনেশন সহ)
app.get('/api/notices', async (req, res) => {
  const notices = await Notice.find().sort({ date: -1 }).limit(5);
  res.json(notices);
});

app.get('/api/notices/latest', async (req, res) => {
  const notice = await Notice.findOne().sort({ date: -1 });
  res.json({ success: true, notice });
});

app.get('/api/notices/all', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const total = await Notice.countDocuments();
    const notices = await Notice.find().sort({ date: -1 }).skip(skip).limit(limit);
    res.json({ success: true, notices, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/notices/add', async (req, res) => {
  try {
    const notice = new Notice({ title: req.body.title, description: req.body.description });
    await notice.save();

    const users = await User.find({ pushToken: { $exists: true, $ne: null }, status: 'approved' });
    const tokens = users.map(u => u.pushToken);
    if (tokens.length > 0) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: tokens, sound: 'default', title: notice.title, body: notice.description.substring(0, 100) }),
      });
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

// ১৭. পোল
app.get('/api/polls/active', async (req, res) => {
  const poll = await Poll.findOne({ isActive: true });
  res.json(poll);
});

app.post('/api/polls/vote', verifyToken, async (req, res) => {
  const { pollId, optionIndex } = req.body;
  const userId = req.userId;
  const poll = await Poll.findById(pollId);
  if (!poll) return res.status(404).json({ success: false, message: 'পোল পাওয়া যায়নি' });
  if (poll.votedUsers.includes(userId)) return res.status(400).json({ success: false, message: 'ইতিমধ্যেই ভোট দিয়েছেন!' });
  poll.options[optionIndex].votes += 1;
  poll.votedUsers.push(userId);
  await poll.save();
  res.json({ success: true, poll });
});

app.post('/api/polls/create', async (req, res) => {
  const newPoll = new Poll({ question: req.body.question, options: req.body.options.split(',').map(o => ({ text: o.trim() })) });
  await newPoll.save();
  res.json({ success: true });
});

// ১৮. ইভেন্ট
app.get('/api/events/upcoming', async (req, res) => {
  const events = await Event.find({ date: { $gte: new Date() } }).sort({ date: 1 }).limit(4);
  res.json({ success: true, events });
});

app.post('/api/events/add', async (req, res) => {
  try {
    const event = new Event(req.body);
    await event.save();

    const users = await User.find({ pushToken: { $exists: true, $ne: null }, status: 'approved' });
    const tokens = users.map(u => u.pushToken);
    if (tokens.length > 0) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: tokens, sound: 'default', title: 'নতুন ইভেন্ট: ' + event.title, body: 'তারিখ: ' + new Date(event.date).toLocaleDateString() }),
      });
    }

    res.json({ success: true, message: 'ইভেন্ট যোগ হয়েছে' });
  } catch (err) { res.status(500).json({ success: false }); }
});

// ১৯. মিশন
app.get('/api/missions/active', verifyToken, async (req, res) => {
  const missions = await Mission.find({ isCompleted: false });
  res.json({ success: true, missions });
});

app.post('/api/missions/create', verifyToken, async (req, res) => {
  const mission = new Mission(req.body);
  await mission.save();
  res.json({ success: true, message: 'মিশন তৈরি হয়েছে' });
});

app.put('/api/missions/:id', verifyToken, async (req, res) => {
  const mission = await Mission.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!mission) return res.status(404).json({ success: false, message: 'মিশন পাওয়া যায়নি' });
  res.json({ success: true, mission });
});

app.delete('/api/missions/:id', verifyToken, async (req, res) => {
  await Mission.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'মিশন মুছে ফেলা হয়েছে' });
});

app.post('/api/missions/verify', verifyToken, async (req, res) => {
  const { missionId } = req.body;
  const mission = await Mission.findById(missionId);
  if (!mission) return res.status(404).json({ success: false, message: 'মিশন পাওয়া যায়নি' });
  if (mission.verifiedBy && mission.verifiedBy.includes(req.userId))
    return res.status(400).json({ success: false, message: 'আপনি ইতিমধ্যে ভেরিফিকেশন সম্পন্ন করেছেন' });

  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });
  user.credits = (user.credits || 0) + 10;
  await user.save();

  mission.verifiedBy = mission.verifiedBy || [];
  mission.verifiedBy.push(req.userId);
  await mission.save();

  res.json({ success: true, message: 'ভেরিফিকেশন সফল! ১০ ক্রেডিট যোগ হয়েছে।', credits: user.credits });
});

// ২০. পুশ টোকেন
app.post('/api/users/push-token', verifyToken, async (req, res) => {
  try {
    const { pushToken } = req.body;
    await User.findByIdAndUpdate(req.userId, { pushToken });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

app.delete('/api/users/push-token', verifyToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.userId, { $unset: { pushToken: 1 } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

// ২১. ফরগট/রিসেট পাসওয়ার্ড (OTP)
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'এই ইমেইলে কোনো অ্যাকাউন্ট নেই' });

    if (user.resetCodeExpires) {
      const lastRequestTime = new Date(user.resetCodeExpires).getTime() - 2 * 60 * 1000;
      if (Date.now() - lastRequestTime < 60 * 1000) {
        return res.status(429).json({ success: false, message: 'অনুগ্রহ করে ১ মিনিট পর আবার চেষ্টা করুন' });
      }
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetCode = code;
    user.resetCodeExpires = new Date(Date.now() + 2 * 60 * 1000);
    await user.save();

    transporter.sendMail({
      from: `"একতাবদ্ধ বি.পি" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '🔐 পাসওয়ার্ড রিসেট OTP',
      html: mailBase(`<h3>পাসওয়ার্ড রিসেট OTP</h3>
        <div style="background: #00adb5; color: white; padding: 20px; border-radius: 10px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; margin: 20px 0;">${code}</div>
        <p style="color: #888;">এই OTP ২ মিনিটের মধ্যে ব্যবহার করুন।</p>`),
    });

    res.json({ success: true, message: 'পাসওয়ার্ড রিসেট OTP ইমেইলে পাঠানো হয়েছে' });
  } catch (err) { res.status(500).json({ success: false, message: 'সার্ভার এরর' }); }
});

app.post('/api/verify-reset-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.resetCode || !user.resetCodeExpires)
      return res.status(400).json({ success: false, message: 'কোড পাওয়া যায়নি, আবার চেষ্টা করুন' });
    if (new Date() > user.resetCodeExpires)
      return res.status(400).json({ success: false, message: 'কোডের মেয়াদ শেষ হয়ে গেছে' });
    if (user.resetCode !== code.trim())
      return res.status(400).json({ success: false, message: 'কোড ভুল' });

    const resetToken = jwt.sign({ id: user._id, purpose: 'reset' }, JWT_SECRET, { expiresIn: '15m' });
    user.resetCode = undefined;
    user.resetCodeExpires = undefined;
    await user.save();
    res.json({ success: true, resetToken });
  } catch (err) { res.status(500).json({ success: false, message: 'সার্ভার এরর' }); }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.purpose !== 'reset') return res.status(400).json({ success: false, message: 'অবৈধ টোকেন' });
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ success: false, message: 'ইউজার পাওয়া যায়নি' });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে' });
  } catch (err) { res.status(500).json({ success: false, message: 'টোকেন অবৈধ বা মেয়াদ উত্তীর্ণ' }); }
});

// ২২. কমিটি
app.post('/api/committee/add', async (req, res) => {
  res.json({ success: true, message: 'কমিটি প্যানেল আপডেট হয়েছে' });
});

// ==================== সার্ভার স্টার্ট ====================
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 একতাবদ্ধ বি.পি সার্ভার চালু হয়েছে: http://localhost:${PORT}`);
});
