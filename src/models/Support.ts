import mongoose, { Schema, InferSchemaType } from "mongoose";

const supportMessageSubSchema = new Schema(
  {
    role: { type: String, enum: ["user", "admin"], required: true },
    content: { type: String, required: true, maxlength: 4000 },
    createdAt: { type: Date, default: Date.now },
    readByAdmin: { type: Boolean, default: false },
    readByUser: { type: Boolean, default: false },
  },
  { _id: true }
);

const supportSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    subject: { type: String, maxlength: 200 },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessageBy: { type: String, enum: ["user", "admin"], default: "user" },
    messages: { type: [supportMessageSubSchema], default: [] },
  },
  { timestamps: true }
);

export type SupportDocument = InferSchemaType<typeof supportSchema> & { _id: mongoose.Types.ObjectId };

export const Support = mongoose.models.Support || mongoose.model("Support", supportSchema);


