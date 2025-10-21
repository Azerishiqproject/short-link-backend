import mongoose, { Schema, InferSchemaType } from "mongoose";

const supportMessageSchema = new Schema(
  {
    threadId: { type: Schema.Types.ObjectId, ref: "SupportThread", required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: false },
    senderRole: { type: String, enum: ["user", "admin"], required: true },
    content: { type: String, required: true, maxlength: 4000 },
    readByAdmin: { type: Boolean, default: false, index: true },
    readByUser: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

export type SupportMessageDocument = InferSchemaType<typeof supportMessageSchema> & { _id: mongoose.Types.ObjectId };

export const SupportMessage = mongoose.models.SupportMessage || mongoose.model("SupportMessage", supportMessageSchema);


