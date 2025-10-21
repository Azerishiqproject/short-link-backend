import { Router } from "express";
import { z } from "zod";
import { Blog } from "../../models/Blog";
import { BlogCategory } from "../../models/BlogCategory";
import { requireAdmin } from "../../middleware/auth";
import { mongoSanitize } from "../../middleware/security";

const router = Router();

// Validation schemas
const blogPostSchema = z.object({
  title: z.string().min(1, "Title is required"),
  excerpt: z.string().min(1, "Excerpt is required"),
  content: z.string().min(1, "Content is required"),
  featuredImage: z.string().url("Valid image URL is required"),
  category: z.string().min(1, "Category is required"),
  tags: z.array(z.string()).optional().default([]),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
});

const categorySchema = z.object({
  name: z.string().min(1, "Category name is required"),
  isActive: z.boolean().default(true),
});

// Helper function to generate slug
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Helper function to calculate read time
function calculateReadTime(content: string): number {
  const wordsPerMinute = 200;
  const wordCount = content.replace(/<[^>]*>/g, '').split(/\s+/).length;
  return Math.ceil(wordCount / wordsPerMinute);
}

// BLOG POSTS ROUTES

// Get all blog posts (admin)
router.get("/posts", requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const search = req.query.search as string;
    const skip = (page - 1) * limit;

    let query: any = {};
    
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

    const totalPosts = await Blog.countDocuments(query);
    const posts = await Blog.find(query)
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
  } catch (error) {
    console.error("Error fetching blog posts:", error);
    return res.status(500).json({ error: "Failed to fetch blog posts" });
  }
});

// Get single blog post (admin)
router.get("/posts/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    const post = await Blog.findById(id).populate('category', 'name');
    
    if (!post) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    return res.json(post);
  } catch (error) {
    console.error("Error fetching blog post:", error);
    return res.status(500).json({ error: "Failed to fetch blog post" });
  }
});

// Create blog post
router.post("/posts", requireAdmin, async (req, res) => {
  try {
    const validatedData = blogPostSchema.parse(req.body);
    
    // Check if category exists
    const category = await BlogCategory.findById(validatedData.category);
    if (!category) {
      return res.status(400).json({ error: "Category not found" });
    }

    // Generate slug
    let slug = generateSlug(validatedData.title);
    let counter = 1;
    let originalSlug = slug;
    
    while (await Blog.findOne({ slug })) {
      slug = `${originalSlug}-${counter}`;
      counter++;
    }

    // Calculate read time
    const readTime = calculateReadTime(validatedData.content);

    const blogPost = new Blog({
      ...validatedData,
      slug,
      readTime,
      publishedAt: validatedData.status === "published" ? new Date() : undefined,
    });

    await blogPost.save();
    await blogPost.populate('category', 'name');

    return res.status(201).json(blogPost);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.issues });
    }
    console.error("Error creating blog post:", error);
    return res.status(500).json({ error: "Failed to create blog post" });
  }
});

// Update blog post
router.put("/posts/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    const validatedData = blogPostSchema.parse(req.body);
    
    // Check if category exists
    const category = await BlogCategory.findById(validatedData.category);
    if (!category) {
      return res.status(400).json({ error: "Category not found" });
    }

    const existingPost = await Blog.findById(id);
    if (!existingPost) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    // Generate new slug if title changed
    let slug = existingPost.slug;
    if (validatedData.title !== existingPost.title) {
      slug = generateSlug(validatedData.title);
      let counter = 1;
      let originalSlug = slug;
      
      while (await Blog.findOne({ slug, _id: { $ne: id } })) {
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

    const updatedPost = await Blog.findByIdAndUpdate(id, updateData, { new: true })
      .populate('category', 'name');

    return res.json(updatedPost);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.issues });
    }
    console.error("Error updating blog post:", error);
    return res.status(500).json({ error: "Failed to update blog post" });
  }
});

// Delete blog post
router.delete("/posts/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    const post = await Blog.findByIdAndDelete(id);
    
    if (!post) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    return res.json({ message: "Blog post deleted successfully" });
  } catch (error) {
    console.error("Error deleting blog post:", error);
    return res.status(500).json({ error: "Failed to delete blog post" });
  }
});

// CATEGORIES ROUTES

// Get all categories (admin)
router.get("/categories", requireAdmin, async (req, res) => {
  try {
    const categories = await BlogCategory.find()
      .sort({ name: 1 });
    
    return res.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    return res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// Create category
router.post("/categories", requireAdmin, async (req, res) => {
  try {
    const validatedData = categorySchema.parse(req.body);
    
    const category = new BlogCategory(validatedData);
    await category.save();

    return res.status(201).json(category);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.issues });
    }
    if ((error as any).code === 11000) {
      return res.status(400).json({ error: "Category name already exists" });
    }
    console.error("Error creating category:", error);
    return res.status(500).json({ error: "Failed to create category" });
  }
});

// Update category
router.put("/categories/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid category ID" });
    }

    const validatedData = categorySchema.parse(req.body);
    
    const category = await BlogCategory.findByIdAndUpdate(id, validatedData, { new: true });
    
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    return res.json(category);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.issues });
    }
    if ((error as any).code === 11000) {
      return res.status(400).json({ error: "Category name already exists" });
    }
    console.error("Error updating category:", error);
    return res.status(500).json({ error: "Failed to update category" });
  }
});

// Delete category
router.delete("/categories/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoSanitize.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid category ID" });
    }

    // Check if category is used by any blog posts
    const postsCount = await Blog.countDocuments({ category: id });
    if (postsCount > 0) {
      return res.status(400).json({ 
        error: "Cannot delete category that is being used by blog posts",
        postsCount 
      });
    }

    const category = await BlogCategory.findByIdAndDelete(id);
    
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    return res.json({ message: "Category deleted successfully" });
  } catch (error) {
    console.error("Error deleting category:", error);
    return res.status(500).json({ error: "Failed to delete category" });
  }
});

export default router;
