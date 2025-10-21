"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const Blog_1 = require("../../models/Blog");
const BlogCategory_1 = require("../../models/BlogCategory");
const auth_1 = require("../../middleware/auth");
const security_1 = require("../../middleware/security");
const router = (0, express_1.Router)();
// Validation schemas
const blogPostSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, "Title is required"),
    excerpt: zod_1.z.string().min(1, "Excerpt is required"),
    content: zod_1.z.string().min(1, "Content is required"),
    featuredImage: zod_1.z.string().url("Valid image URL is required"),
    category: zod_1.z.string().min(1, "Category is required"),
    tags: zod_1.z.array(zod_1.z.string()).optional().default([]),
    status: zod_1.z.enum(["draft", "published", "archived"]).default("draft"),
    seoTitle: zod_1.z.string().optional(),
    seoDescription: zod_1.z.string().optional(),
});
const categorySchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Category name is required"),
    isActive: zod_1.z.boolean().default(true),
});
// Helper function to generate slug
function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}
// Helper function to calculate read time
function calculateReadTime(content) {
    const wordsPerMinute = 200;
    const wordCount = content.replace(/<[^>]*>/g, '').split(/\s+/).length;
    return Math.ceil(wordCount / wordsPerMinute);
}
// BLOG POSTS ROUTES
// Get all blog posts (admin)
router.get("/posts", auth_1.requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status;
        const search = req.query.search;
        const skip = (page - 1) * limit;
        let query = {};
        if (status) {
            query.status = status;
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
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
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
// Get single blog post (admin)
router.get("/posts/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid post ID" });
        }
        const post = await Blog_1.Blog.findById(id).populate('category', 'name');
        if (!post) {
            return res.status(404).json({ error: "Blog post not found" });
        }
        return res.json(post);
    }
    catch (error) {
        console.error("Error fetching blog post:", error);
        return res.status(500).json({ error: "Failed to fetch blog post" });
    }
});
// Create blog post
router.post("/posts", auth_1.requireAdmin, async (req, res) => {
    try {
        const validatedData = blogPostSchema.parse(req.body);
        // Check if category exists
        const category = await BlogCategory_1.BlogCategory.findById(validatedData.category);
        if (!category) {
            return res.status(400).json({ error: "Category not found" });
        }
        // Generate slug
        let slug = generateSlug(validatedData.title);
        let counter = 1;
        let originalSlug = slug;
        while (await Blog_1.Blog.findOne({ slug })) {
            slug = `${originalSlug}-${counter}`;
            counter++;
        }
        // Calculate read time
        const readTime = calculateReadTime(validatedData.content);
        const blogPost = new Blog_1.Blog({
            ...validatedData,
            slug,
            readTime,
            publishedAt: validatedData.status === "published" ? new Date() : undefined,
        });
        await blogPost.save();
        await blogPost.populate('category', 'name');
        return res.status(201).json(blogPost);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: "Validation error", details: error.issues });
        }
        console.error("Error creating blog post:", error);
        return res.status(500).json({ error: "Failed to create blog post" });
    }
});
// Update blog post
router.put("/posts/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid post ID" });
        }
        const validatedData = blogPostSchema.parse(req.body);
        // Check if category exists
        const category = await BlogCategory_1.BlogCategory.findById(validatedData.category);
        if (!category) {
            return res.status(400).json({ error: "Category not found" });
        }
        const existingPost = await Blog_1.Blog.findById(id);
        if (!existingPost) {
            return res.status(404).json({ error: "Blog post not found" });
        }
        // Generate new slug if title changed
        let slug = existingPost.slug;
        if (validatedData.title !== existingPost.title) {
            slug = generateSlug(validatedData.title);
            let counter = 1;
            let originalSlug = slug;
            while (await Blog_1.Blog.findOne({ slug, _id: { $ne: id } })) {
                slug = `${originalSlug}-${counter}`;
                counter++;
            }
        }
        // Calculate read time
        const readTime = calculateReadTime(validatedData.content);
        const updateData = {
            ...validatedData,
            slug,
            readTime,
            publishedAt: validatedData.status === "published" && existingPost.status !== "published"
                ? new Date()
                : existingPost.publishedAt,
        };
        const updatedPost = await Blog_1.Blog.findByIdAndUpdate(id, updateData, { new: true })
            .populate('category', 'name');
        return res.json(updatedPost);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: "Validation error", details: error.issues });
        }
        console.error("Error updating blog post:", error);
        return res.status(500).json({ error: "Failed to update blog post" });
    }
});
// Delete blog post
router.delete("/posts/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid post ID" });
        }
        const post = await Blog_1.Blog.findByIdAndDelete(id);
        if (!post) {
            return res.status(404).json({ error: "Blog post not found" });
        }
        return res.json({ message: "Blog post deleted successfully" });
    }
    catch (error) {
        console.error("Error deleting blog post:", error);
        return res.status(500).json({ error: "Failed to delete blog post" });
    }
});
// CATEGORIES ROUTES
// Get all categories (admin)
router.get("/categories", auth_1.requireAdmin, async (req, res) => {
    try {
        const categories = await BlogCategory_1.BlogCategory.find()
            .sort({ name: 1 });
        return res.json(categories);
    }
    catch (error) {
        console.error("Error fetching categories:", error);
        return res.status(500).json({ error: "Failed to fetch categories" });
    }
});
// Create category
router.post("/categories", auth_1.requireAdmin, async (req, res) => {
    try {
        const validatedData = categorySchema.parse(req.body);
        const category = new BlogCategory_1.BlogCategory(validatedData);
        await category.save();
        return res.status(201).json(category);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: "Validation error", details: error.issues });
        }
        if (error.code === 11000) {
            return res.status(400).json({ error: "Category name already exists" });
        }
        console.error("Error creating category:", error);
        return res.status(500).json({ error: "Failed to create category" });
    }
});
// Update category
router.put("/categories/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid category ID" });
        }
        const validatedData = categorySchema.parse(req.body);
        const category = await BlogCategory_1.BlogCategory.findByIdAndUpdate(id, validatedData, { new: true });
        if (!category) {
            return res.status(404).json({ error: "Category not found" });
        }
        return res.json(category);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: "Validation error", details: error.issues });
        }
        if (error.code === 11000) {
            return res.status(400).json({ error: "Category name already exists" });
        }
        console.error("Error updating category:", error);
        return res.status(500).json({ error: "Failed to update category" });
    }
});
// Delete category
router.delete("/categories/:id", auth_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!security_1.mongoSanitize.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid category ID" });
        }
        // Check if category is used by any blog posts
        const postsCount = await Blog_1.Blog.countDocuments({ category: id });
        if (postsCount > 0) {
            return res.status(400).json({
                error: "Cannot delete category that is being used by blog posts",
                postsCount
            });
        }
        const category = await BlogCategory_1.BlogCategory.findByIdAndDelete(id);
        if (!category) {
            return res.status(404).json({ error: "Category not found" });
        }
        return res.json({ message: "Category deleted successfully" });
    }
    catch (error) {
        console.error("Error deleting category:", error);
        return res.status(500).json({ error: "Failed to delete category" });
    }
});
exports.default = router;
