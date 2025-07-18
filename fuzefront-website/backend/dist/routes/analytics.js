"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyticsRoutes = void 0;
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const zod_1 = require("zod");
const router = express_1.default.Router();
exports.analyticsRoutes = router;
// Analytics event validation schema
const analyticsSchema = zod_1.z.object({
    event: zod_1.z.string().min(1, 'Event name required'),
    page: zod_1.z.string().min(1, 'Page required'),
    timestamp: zod_1.z.string().datetime().optional(),
    userAgent: zod_1.z.string().optional(),
    referrer: zod_1.z.string().optional(),
    sessionId: zod_1.z.string().optional(),
    properties: zod_1.z.record(zod_1.z.unknown()).optional(),
});
// In-memory store for development (replace with database/analytics service in production)
const events = [];
// Track page view
router.post('/page-view', [
    (0, express_validator_1.body)('page').trim().isLength({ min: 1 }),
    (0, express_validator_1.body)('referrer').optional().trim(),
    (0, express_validator_1.body)('sessionId').optional().trim(),
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }
        const eventData = {
            event: 'page_view',
            page: req.body.page,
            timestamp: new Date().toISOString(),
            userAgent: req.get('User-Agent'),
            referrer: req.body.referrer || req.get('Referrer'),
            sessionId: req.body.sessionId,
            ip: req.ip || '',
            properties: req.body.properties
        };
        events.push(eventData);
        console.log('📊 Page view:', eventData);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Analytics page view error:', error);
        res.status(500).json({ error: 'Failed to track page view' });
    }
});
// Track custom event
router.post('/event', [
    (0, express_validator_1.body)('event').trim().isLength({ min: 1 }),
    (0, express_validator_1.body)('page').trim().isLength({ min: 1 }),
    (0, express_validator_1.body)('properties').optional().isObject(),
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }
        const validatedData = analyticsSchema.parse({
            ...req.body,
            timestamp: req.body.timestamp || new Date().toISOString()
        });
        const eventData = {
            event: validatedData.event,
            page: validatedData.page,
            timestamp: validatedData.timestamp || new Date().toISOString(),
            userAgent: req.get('User-Agent'),
            referrer: req.get('Referrer'),
            sessionId: validatedData.sessionId,
            ip: req.ip || '',
            properties: validatedData.properties,
        };
        events.push(eventData);
        console.log('📊 Custom event:', eventData);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Analytics event error:', error);
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.errors
            });
        }
        res.status(500).json({ error: 'Failed to track event' });
    }
});
// Get analytics summary (for admin use)
router.get('/summary', (req, res) => {
    // In production, add authentication middleware
    const summary = {
        totalEvents: events.length,
        pageViews: events.filter(e => e.event === 'page_view').length,
        customEvents: events.filter(e => e.event !== 'page_view').length,
        uniquePages: [...new Set(events.map(e => e.page))].length,
        recentEvents: events.slice(-10).reverse(),
        timestamp: new Date().toISOString()
    };
    res.json(summary);
});
// Get page analytics
router.get('/pages', (req, res) => {
    // In production, add authentication middleware
    const pageViews = events.filter(e => e.event === 'page_view');
    const pageStats = pageViews.reduce((acc, event) => {
        acc[event.page] = (acc[event.page] || 0) + 1;
        return acc;
    }, {});
    const sortedPages = Object.entries(pageStats)
        .sort(([, a], [, b]) => b - a)
        .map(([page, views]) => ({ page, views }));
    res.json({
        pages: sortedPages,
        totalPageViews: pageViews.length,
        timestamp: new Date().toISOString()
    });
});
//# sourceMappingURL=analytics.js.map