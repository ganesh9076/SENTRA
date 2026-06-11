require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());
app.use(cors());

//  MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("SENTRA Database Connected"))
    .catch(err => {
        console.error("❌ MongoDB Connection Error:");
        console.error(err.message);
    });

// Extra Debug Logs
mongoose.connection.on('connected', () => {
    console.log("Mongoose connected to DB");
});

mongoose.connection.on('error', (err) => {
    console.log("Mongoose error:", err);
});

//  User Model
const userSchema = new mongoose.Schema({
    firstName: String,
    lastName: String,
    email: { type: String, unique: true, required: true },
    password: String,
    nodeRole: String,
    joinedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

//  Signup
app.post('/api/signup', async (req, res) => {
    try {
        const { firstName, lastName, email, password, nodeRole } = req.body;

        const existing = await User.findOne({ email: email.toLowerCase() });
        if (existing) return res.status(400).json({ error: "Email already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            firstName,
            lastName,
            email: email.toLowerCase(),
            password: hashedPassword,
            nodeRole
        });

        await newUser.save();
        res.status(201).json({ message: "User secured and created" });

    } catch (err) {
        res.status(500).json({ error: "Error during signup" });
    }
});

//  Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(404).json({ error: "User not found" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: "Invalid password" });

        res.json({
            user: {
                name: `${user.firstName} ${user.lastName}`,
                email: user.email,
                role: user.nodeRole
            }
        });

    } catch (err) {
        res.status(500).json({ error: "Login error" });
    }
});

//  Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`SENTRA Server running on port ${PORT}`));