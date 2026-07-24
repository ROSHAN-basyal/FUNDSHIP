import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import bcrypt from "bcryptjs";
import postgres from "postgres";

const credentialPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;
const avatarColors = ["#086B68", "#B04A38", "#4E5FA8", "#7B5A30", "#8A4776", "#34725A"];

function hiddenQuestion(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("This command must be run in an interactive terminal.");
  }

  return new Promise((resolve, reject) => {
    let value = "";
    stdout.write(label);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();

    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (input: string | Buffer) => {
      const key = input.toString();
      if (key === "\u0003") {
        finish(new Error("Cancelled."));
        return;
      }
      if (key === "\r" || key === "\n") {
        finish();
        return;
      }
      if (key === "\u007f" || key === "\b") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }
      if (key.startsWith("\u001b")) return;

      const printable = [...key].filter((character) => character >= " " && character !== "\u007f").join("");
      if (printable) {
        value += printable;
        stdout.write("*".repeat(printable.length));
      }
    };

    stdin.on("data", onData);
  });
}

function colorFor(value: string) {
  const total = [...value].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return avatarColors[total % avatarColors.length];
}

async function main() {
  stdout.write("FUNDSHIP beta account issuer\n\n");

  let databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    databaseUrl = (await hiddenQuestion("Supabase transaction-pooler URL: ")).trim();
  }
  if (!databaseUrl) throw new Error("A Supabase DATABASE_URL is required.");

  let databaseHost = "";
  try {
    databaseHost = new URL(databaseUrl).host;
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL.");
  }

  const prompt = createInterface({ input: stdin, output: stdout });
  const credentialId = (await prompt.question("User ID: ")).trim();
  const name = (await prompt.question("Full display name: ")).trim();
  prompt.close();

  if (!credentialPattern.test(credentialId)) {
    throw new Error("User ID must be 3-32 letters, numbers, underscores, or hyphens.");
  }
  if (name.length < 2 || name.length > 80) {
    throw new Error("Display name must be between 2 and 80 characters.");
  }

  const initialPassword = await hiddenQuestion("Initial password: ");
  const confirmedPassword = await hiddenQuestion("Confirm initial password: ");
  if (initialPassword.length < 8) throw new Error("Initial password must contain at least 8 characters.");
  if (initialPassword !== confirmedPassword) throw new Error("The passwords do not match.");

  const passwordHash = await bcrypt.hash(initialPassword, 12);
  const userId = randomUUID();
  const ssl = process.env.DATABASE_SSL === "disable" ? false : "require";
  const sql = postgres(databaseUrl, { max: 1, prepare: false, ssl });

  try {
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE LOWER(credential_id) = LOWER(${credentialId}) LIMIT 1
    `;
    if (existing.length) throw new Error(`User ID "${credentialId}" already exists.`);

    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO users (
          id, credential_id, name, password_hash, mpin_hash, phone,
          avatar_color, profile_photo, must_change_password
        ) VALUES (
          ${userId}, ${credentialId}, ${name}, ${passwordHash}, NULL, NULL,
          ${colorFor(credentialId)}, NULL, TRUE
        )
      `;
      await transaction`
        INSERT INTO user_sync_state (user_id, revision, updated_at)
        VALUES (${userId}, 1, ${new Date().toISOString()})
      `;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }

  stdout.write(`\nAccount "${credentialId}" created on ${databaseHost}.\n`);
  stdout.write("The user must replace the initial password at first login.\n");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unable to create the account.";
  process.stderr.write(`\nAccount creation failed: ${message}\n`);
  process.exitCode = 1;
});
