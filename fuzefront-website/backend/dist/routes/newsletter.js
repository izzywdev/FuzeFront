"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.newsletterRoutes = void 0;
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const zod_1 = require("zod");
const router = express_1.default.Router();
exports.newsletterRoutes = router;
// Newsletter subscription validation schema
const newsletterSchema = zod_1.z.object({
    email: zod_1.z.string().email('Invalid email address'),
    name: zod_1.z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long').optional(),
    interests: zod_1.z.array(zod_1.z.enum(['platform', 'infrastructure', 'updates', 'blog', 'events'])).optional(),
});
// In-memory store for development (replace with database in production)
const subscribers = new Set();
// Subscribe to newsletter
router.post('/subscribe', [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
    (0, express_validator_1.body)('name').optional().trim().isLength({ min: 2, max: 100 }).escape(),
    (0, express_validator_1.body)('interests').optional().isArray(),
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
        const validatedData = newsletterSchema.parse(req.body);
        // Check if already subscribed
        if (subscribers.has(validatedData.email)) {
            return res.json({
                success: true,
                message: 'You are already subscribed to our newsletter!',
                alreadySubscribed: true
            });
        }
        // Add to subscribers (in production, save to database)
        subscribers.add(validatedData.email);
        console.log('📧 Newsletter subscription:', {
            email: validatedData.email,
            name: validatedData.name,
            interests: validatedData.interests,
            timestamp: new Date().toISOString()
        });
        // In production, you would:
        // 1. Save to database
        // 2. Send confirmation email
        // 3. Add to email marketing platform (Mailchimp, SendGrid, etc.)
        res.json({
            success: true,
            message: 'Thank you for subscribing to our newsletter!',
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('Newsletter subscription error:', error);
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.errors
            });
        }
        res.status(500).json({
            error: 'Failed to subscribe',
            message: 'Please try again later.'
        });
    }
});
// Unsubscribe from newsletter
router.post('/unsubscribe', [
    (0, express_validator_1.body)('email').isEmail().normalizeEmail(),
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }
        const { email } = req.body;
        // Remove from subscribers
        subscribers.delete(email);
        console.log('📧 Newsletter unsubscribe:', {
            email,
            timestamp: new Date().toISOString()
        });
        res.json({
            success: true,
            message: 'You have been unsubscribed from our newsletter.',
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('Newsletter unsubscribe error:', error);
        res.status(500).json({
            error: 'Failed to unsubscribe',
            message: 'Please try again later.'
        });
    }
});
// Get newsletter stats (for admin use)
router.get('/stats', (req, res) => {
    // In production, add authentication middleware
    res.json({
        totalSubscribers: subscribers.size,
        timestamp: new Date().toISOString()
    });
});
//# sourceMappingURL=newsletter.js.map