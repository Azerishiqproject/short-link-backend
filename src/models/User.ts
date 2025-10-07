import mongoose, { Schema, InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    passwordSalt: { type: String, required: false },
    name: { type: String },
    role: { type: String, enum: ["user", "admin", "advertiser"], default: "user" },
    available_balance: { type: Number, default: 0 },
    reserved_balance: { type: Number, default: 0 },
    earned_balance: { type: Number, default: 0 }, // Kullanıcıların kazandığı ama henüz çekmediği para
  reserved_earned_balance: { type: Number, default: 0 }, // Çekim isteği için rezerve edilen para
    // IBAN bilgileri
    iban: { type: String, required: false, maxlength: 26 },
    fullName: { type: String, required: false, maxlength: 100 },
    paymentDescription: { type: String, required: false, maxlength: 100 },
  },
  { timestamps: true }
);

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };

export const User = mongoose.models.User || mongoose.model("User", userSchema);


