import readline from "node:readline";
import { provisionOperator } from "../src/lib/auth/operator";
import { MIN_PASSWORD_LENGTH } from "../src/lib/auth/password";
import { prisma } from "../src/lib/prisma";

/**
 * Prompts for user input via interactive terminal.
 * Mutes output when prompt is a secret to avoid echoing passwords to terminal.
 */
function promptInput(promptText: string, mute = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (mute) {
      process.stdout.write(promptText);
      const originalWrite = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = function (stringToWrite: string) {
        if (stringToWrite.includes("\r") || stringToWrite.includes("\n")) {
          process.stdout.write("\n");
        }
      };

      rl.question("", (answer) => {
        (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = originalWrite;
        rl.close();
        resolve(answer.trim());
      });
    } else {
      rl.question(promptText, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

export async function runCli(): Promise<void> {
  try {
    let username = process.env.OPERATOR_USERNAME?.trim() || "";
    let password =
      process.env.OPERATOR_PASSWORD ||
      process.env.OPERATOR_INITIAL_PASSWORD ||
      "";

    // If password is not provided via environment, prompt if interactive
    if (!password) {
      if (process.stdin.isTTY) {
        console.log("=== Uptime Atlas — Initial Operator Provisioning ===");
        if (!username) {
          const promptedUsername = await promptInput("Operator username [admin]: ");
          username = promptedUsername || "admin";
        }
        password = await promptInput(`Enter password (min ${MIN_PASSWORD_LENGTH} chars): `, true);
      } else {
        console.error("[Operator Seed] Error: No operator password provided.");
        console.error(
          "Set OPERATOR_PASSWORD (or OPERATOR_INITIAL_PASSWORD) in .env.local or environment, or run interactively in a TTY terminal."
        );
        process.exit(1);
      }
    }

    const result = await provisionOperator({ username, password });

    if (result.success) {
      console.log(`[Operator Seed] Success: ${result.message} (id: ${result.operator?.id})`);
    } else {
      if (result.message.includes("already exists")) {
        console.log(`[Operator Seed] ${result.message}`);
      } else {
        console.error(`[Operator Seed] Error: ${result.message}`);
        process.exit(1);
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Operator Seed] Unexpected error: ${message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Execute when run directly via tsx
runCli();

