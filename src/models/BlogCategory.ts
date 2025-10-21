import mongoose, { Schema, InferSchemaType } from "mongoose";

const blogCategorySchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type BlogCategoryDocument = InferSchemaType<typeof blogCategorySchema> & { _id: mongoose.Types.ObjectId };

export const BlogCategory = mongoose.models.BlogCategory || mongoose.model("BlogCategory", blogCategorySchema);
