import mongoose, { Schema, InferSchemaType } from "mongoose";

const supportThreadSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessageBy: { type: String, enum: ["user", "admin"], default: "user" },
    subject: { type: String, required: false, maxlength: 200 },
  },
  { timestamps: true }
);

export type SupportThreadDocument = InferSchemaType<typeof supportThreadSchema> & { _id: mongoose.Types.ObjectId };

export const SupportThread = mongoose.models.SupportThread || mongoose.model("SupportThread", supportThreadSchema);


