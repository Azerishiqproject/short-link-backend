import mongoose, { Schema, InferSchemaType } from "mongoose";

const contactSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 100 },
    email: { type: String, required: true, maxlength: 100 },
    subject: { type: String, required: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 2000 },
    readByAdmin: { type: Boolean, default: false, index: true },
    replied: { type: Boolean, default: false },
    ipAddress: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true }
);

export type ContactDocument = InferSchemaType<typeof contactSchema> & { _id: mongoose.Types.ObjectId };

export const Contact = mongoose.models.Contact || mongoose.model("Contact", contactSchema);

