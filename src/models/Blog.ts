import mongoose, { Schema, InferSchemaType } from "mongoose";

const blogSchema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    excerpt: { type: String, required: true },
    content: { type: String, required: true }, // HTML content
    featuredImage: { type: String, required: true },
    category: { type: Schema.Types.ObjectId, ref: "BlogCategory", required: true },
    tags: [{ type: String }],
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft" },
    publishedAt: { type: Date },
    readTime: { type: Number, default: 0 }, // minutes
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    seoTitle: { type: String },
    seoDescription: { type: String },
  },
  { timestamps: true }
);

// Create index for slug
blogSchema.index({ slug: 1 });
blogSchema.index({ status: 1 });
blogSchema.index({ category: 1 });
blogSchema.index({ publishedAt: -1 });

export type BlogDocument = InferSchemaType<typeof blogSchema> & { _id: mongoose.Types.ObjectId };

export const Blog = mongoose.models.Blog || mongoose.model("Blog", blogSchema);
