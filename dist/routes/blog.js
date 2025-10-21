"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Blog_1 = require("../models/Blog");
const BlogCategory_1 = require("../models/BlogCategory");
const security_1 = require("../middleware/security");
const router = (0, express_1.Router)();
// Get all published blog posts with pagination
router.get("/posts", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const category = req.query.category;
        const search = req.query.search;
        const skip = (page - 1) * limit;
        // Build query
        let query = { status: "published" };
        if (category && security_1.mongoSanitize.isValidObjectId(category)) {
            query.category = security_1.mongoSanitize.sanitizeQuery({ _id: category });
        }
        if (search) {
            const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            query.$or = [
                { title: searchRegex },
                { excerpt: searchRegex },
                { tags: { $in: [searchRegex] } }
            ];
        }
        const totalPosts = await Blog_1.Blog.countDocuments(query);
        const posts = await Blog_1.Blog.find(query)
            .populate('category', 'name')
            .sort({ publishedAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('-content'); // Exclude full content for list view
        return res.json({
            posts,
            pagination: {
                page,
                limit,
                total: totalPosts,
                totalPages: Math.ceil(totalPosts / limit),
                hasNext: page < Math.ceil(totalPosts / limit),
                hasPrev: page > 1,
            }
        });
    }
    catch (error) {
        console.error("Error fetching blog posts:", error);
        return res.status(500).json({ error: "Failed to fetch blog posts" });
    }
});
// Get single blog post by slug
router.get("/posts/:slug", async (req, res) => {
    try {
        const { slug } = req.params;
        const post = await Blog_1.Blog.findOne({ slug, status: "published" })
            .populate('category', 'name');
        if (!post) {
            return res.status(404).json({ error: "Blog post not found" });
        }
        // Increment view count
        await Blog_1.Blog.findByIdAndUpdate(post._id, { $inc: { views: 1 } });
        return res.json(post);
    }
    catch (error) {
        console.error("Error fetching blog post:", error);
        return res.status(500).json({ error: "Failed to fetch blog post" });
    }
});
// Get all categories
router.get("/categories", async (req, res) => {
    try {
        const categories = await BlogCategory_1.BlogCategory.find({ isActive: true })
            .sort({ name: 1 });
        return res.json(categories);
    }
    catch (error) {
        console.error("Error fetching categories:", error);
        return res.status(500).json({ error: "Failed to fetch categories" });
    }
});
// Get related posts
router.get("/related/:id", async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid post ID" });
        }
        const post = await Blog_1.Blog.findById(id).populate('category', 'name');
        if (!post) {
            return res.status(404).json({ error: "Post not found" });
        }
        const relatedPosts = await Blog_1.Blog.find({
            _id: { $ne: post._id },
            category: post.category._id,
            status: "published"
        })
            .populate('category', 'name')
            .select('-content')
            .limit(3)
            .sort({ publishedAt: -1 });
        return res.json(relatedPosts);
    }
    catch (error) {
        console.error("Error fetching related posts:", error);
        return res.status(500).json({ error: "Failed to fetch related posts" });
    }
});
// Get featured posts
router.get("/featured", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 3;
        const featuredPosts = await Blog_1.Blog.find({ status: "published" })
            .populate('category', 'name')
            .select('-content')
            .sort({ views: -1, publishedAt: -1 })
            .limit(limit);
        return res.json(featuredPosts);
    }
    catch (error) {
        console.error("Error fetching featured posts:", error);
        return res.status(500).json({ error: "Failed to fetch featured posts" });
    }
});
exports.default = router;
