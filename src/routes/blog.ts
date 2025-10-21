import { Router } from "express";
import { z } from "zod";
import { Blog } from "../models/Blog";
import { BlogCategory } from "../models/BlogCategory";
import { mongoSanitize } from "../middleware/security";

const router = Router();

// Get all published blog posts with pagination
router.get("/posts", async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const category = req.query.category as string;
    const search = req.query.search as string;
    const skip = (page - 1) * limit;

    // Build query
    let query: any = { status: "published" };
    
    if (category && mongoSanitize.isValidObjectId(category)) {
      query.category = mongoSanitize.sanitizeQuery({ _id: category });
    }
    
    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { title: searchRegex },
        { excerpt: searchRegex },
        { tags: { $in: [searchRegex] } }
      ];
    }

    const totalPosts = await Blog.countDocuments(query);
    const posts = await Blog.find(query)
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
  } catch (error) {
    console.error("Error fetching blog posts:", error);
    return res.status(500).json({ error: "Failed to fetch blog posts" });
  }
});

// Get single blog post by slug
router.get("/posts/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    
    const post = await Blog.findOne({ slug, status: "published" })
      .populate('category', 'name');
    
    if (!post) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    // Increment view count
    await Blog.findByIdAndUpdate(post._id, { $inc: { views: 1 } });

    return res.json(post);
  } catch (error) {
    console.error("Error fetching blog post:", error);
    return res.status(500).json({ error: "Failed to fetch blog post" });
  }
});

// Get all categories
router.get("/categories", async (req, res) => {
  try {
    const categories = await BlogCategory.find({ isActive: true })
      .sort({ name: 1 });
    
    return res.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    return res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// Get related posts
router.get("/related/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    const post = await Blog.findById(id).populate('category', 'name');
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const relatedPosts = await Blog.find({
      _id: { $ne: post._id },
      category: post.category._id,
      status: "published"
    })
      .populate('category', 'name')
      .select('-content')
      .limit(3)
      .sort({ publishedAt: -1 });

    return res.json(relatedPosts);
  } catch (error) {
    console.error("Error fetching related posts:", error);
    return res.status(500).json({ error: "Failed to fetch related posts" });
  }
});

// Get featured posts
router.get("/featured", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 3;
    
    const featuredPosts = await Blog.find({ status: "published" })
      .populate('category', 'name')
      .select('-content')
      .sort({ views: -1, publishedAt: -1 })
      .limit(limit);

    return res.json(featuredPosts);
  } catch (error) {
    console.error("Error fetching featured posts:", error);
    return res.status(500).json({ error: "Failed to fetch featured posts" });
  }
});

export default router;

