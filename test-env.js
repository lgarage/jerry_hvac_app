require("dotenv").config();

console.log("=== Environment Variable Test ===");
console.log("OPENAI_API_KEY loaded:", !!process.env.OPENAI_API_KEY);
console.log(
  "OPENAI_API_KEY value:",
  process.env.OPENAI_API_KEY
    ? process.env.OPENAI_API_KEY.substring(0, 7) + "..."
    : "NOT SET"
);
console.log("PORT:", process.env.PORT || "3000 (default)");
