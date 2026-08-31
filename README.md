# Constra

Construction drawing annotation tool. See `CLAUDE.md` for the project brief,
data model, and team charter.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your real Neon DATABASE_URL
npx tsx scripts/migrate.ts   # apply DB migrations
npx tsx scripts/import-pdf.ts # download + convert the sample PDF, seed the DB
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see it running.
