"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactRoutes = void 0;
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const nodemailer_1 = __importDefault(require("nodemailer"));
const zod_1 = require("zod");
const router = express_1.default.Router();
exports.contactRoutes = router;
// Contact form validation schema
const contactSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long'),
    email: zod_1.z.string().email('Invalid email address'),
    company: zod_1.z.string().max(100, 'Company name too long').optional(),
    subject: zod_1.z.string().min(5, 'Subject must be at least 5 characters').max(200, 'Subject too long'),
    message: zod_1.z.string().min(10, 'Message must be at least 10 characters').max(2000, 'Message too long'),
    phone: zod_1.z.string().max(20, 'Phone number too long').optional(),
    interest: zod_1.z.enum(['platform', 'infrastructure', 'consultation', 'partnership', 'other']).optional(),
});
// Configure nodemailer transporter
const createTransporter = () => {
    if (process.env.NODE_ENV === 'production') {
        return nodemailer_1.default.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });
    }
    else {
        // Development mode - log to console
        return nodemailer_1.default.createTransport({
            streamTransport: true,
            newline: 'unix',
            buffer: true,
        });
    }
};
// Contact form submission
router.post('/submit', [
    (0, express_validator_1.body)('name').trim().isLength({ min: 2, max: 100 }).escape(),
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
    (0, express_validator_1.body)('company').optional().trim().isLength({ max: 100 }).escape(),
    (0, express_validator_1.body)('subject').trim().isLength({ min: 5, max: 200 }).escape(),
    (0, express_validator_1.body)('message').trim().isLength({ min: 10, max: 2000 }).escape(),
    (0, express_validator_1.body)('phone').optional().trim().isLength({ max: 20 }).escape(),
    (0, express_validator_1.body)('interest').optional().isIn(['platform', 'infrastructure', 'consultation', 'partnership', 'other']),
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }
        // Validate with Zod
        const validatedData = contactSchema.parse(req.body);
        // Create email content
        const emailContent = `
New Contact Form Submission - FuzeFront.com

Name: ${validatedData.name}
Email: ${validatedData.email}
Company: ${validatedData.company || 'Not provided'}
Phone: ${validatedData.phone || 'Not provided'}
Interest: ${validatedData.interest || 'Not specified'}

Subject: ${validatedData.subject}

Message:
${validatedData.message}

---
Submitted at: ${new Date().toISOString()}
IP Address: ${req.ip}
User Agent: ${req.get('User-Agent')}
`;
        // Send email
        const transporter = createTransporter();
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'noreply@fuzefront.com',
            to: process.env.EMAIL_TO || 'contact@fuzefront.com',
            subject: `[FuzeFront Contact] ${validatedData.subject}`,
            text: emailContent,
            replyTo: validatedData.email,
        };
        if (process.env.NODE_ENV === 'production') {
            await transporter.sendMail(mailOptions);
        }
        else {
            console.log('📧 Contact form submission (development mode):');
            console.log(emailContent);
        }
        // Send auto-reply to user
        const autoReplyOptions = {
            from: process.env.EMAIL_FROM || 'noreply@fuzefront.com',
            to: validatedData.email,
            subject: 'Thank you for contacting FuzeFront',
            text: `Hi ${validatedData.name},

Thank you for reaching out to FuzeFront! We've received your message and will get back to you within 24 hours.

Your message:
Subject: ${validatedData.subject}
${validatedData.message}

Best regards,
The FuzeFront Team

---
This is an automated response. Please don't reply to this email.
For urgent matters, please contact us at contact@fuzefront.com
`,
        };
        if (process.env.NODE_ENV === 'production') {
            await transporter.sendMail(autoReplyOptions);
        }
        res.json({
            success: true,
            message: 'Thank you for your message! We\'ll get back to you soon.',
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('Contact form error:', error);
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.errors
            });
        }
        res.status(500).json({
            error: 'Failed to send message',
            message: 'Please try again later or contact us directly.'
        });
    }
});
//# sourceMappingURL=contact.js.map