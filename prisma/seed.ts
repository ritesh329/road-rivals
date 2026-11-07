import { PrismaClient } from "@prisma/client";
import { seedCatalog } from "./seedCore";

const prisma = new PrismaClient();
seedCatalog(prisma)
  .then(() => console.log("Seed complete"))
  .finally(() => prisma.$disconnect());
