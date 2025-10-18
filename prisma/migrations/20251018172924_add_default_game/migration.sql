-- AlterTable
ALTER TABLE "users" ADD COLUMN     "default_game" STRING;

-- Set 'lingo' for existing users
UPDATE "users" SET "default_game" = 'lingo' WHERE "default_game" IS NULL;
