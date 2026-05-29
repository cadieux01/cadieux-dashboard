# Sunny Admin Dashboard

A production-ready admin dashboard for managing bread sales, trainers, leads, and alerts.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the contents of `supabase-schema.sql`
3. Create an admin user:
   - Go to **Authentication** → **Users** → **Add User**
   - Create a user with email/password
   - Note the user ID
   - Run this SQL (replace `YOUR_USER_ID`):
   ```sql
   UPDATE public.profiles SET role = 'admin' WHERE id = 'YOUR_USER_ID';
   ```

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Get these values from: **Supabase Dashboard** → **Project Settings** → **API**

### 4. Run the Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## 📁 Project Structure

```
src/
├── components/     # Reusable UI components
├── context/        # React context (Auth)
├── lib/            # Utilities (Supabase client)
├── pages/          # Page components
│   ├── Sales.jsx
│   ├── Leads.jsx
│   ├── CTA.jsx
│   └── Login.jsx
├── router.jsx      # Route definitions
└── main.jsx        # App entry point
```

## 🔐 Authentication

- **Admin-only access**: Only users with `role = 'admin'` in the `profiles` table can access the dashboard
- Login page is at `/login`
- All routes are protected by authentication guards

## 📊 Features

- **Sales Dashboard**: Track sales, trainer rankings, KPIs
- **Leads Management**: Filter, search, and track lead conversions
- **CTA Dashboard**: Traffic light system for expiry alerts (🟢🟡🔴)

## 🛠️ Tech Stack

- React 19 + Vite
- Supabase (Auth + Database)
- Tailwind CSS
- Recharts
- React Router

## 📝 Database Schema

See `supabase-schema.sql` for complete schema with RLS policies.

Tables:
- `profiles` - User profiles with roles
- `trainers` - Trainer information
- `sales` - Sales records
- `leads` - Lead tracking
- Views: `trainer_rankings`, `expiry_alerts`

## 🔒 Security

- Row Level Security (RLS) enabled on all tables
- Admin-only policies for read/write access
- No service role key in frontend
- Protected routes with auth guards

## 🌐 GitHub Pages Deployment

The app is configured to deploy automatically to GitHub Pages when you push to the `main` branch.

### Setup Steps:

1. **Enable GitHub Pages**:
   - Go to your GitHub repo: `https://github.com/spraymachine/sunny`
   - Navigate to **Settings** → **Pages**
   - Under **Source**, select **GitHub Actions**
   - Save the settings

2. **Configure Environment Variables** (for GitHub Pages):
   - Go to **Settings** → **Secrets and variables** → **Actions**
   - Add these repository secrets:
     - `VITE_SUPABASE_URL` - Your Supabase project URL
     - `VITE_SUPABASE_ANON_KEY` - Your Supabase anon key
   
   **Note**: Since GitHub Pages is a static site, you'll need to set these as build-time environment variables. The GitHub Actions workflow will use them during the build process.

3. **Update GitHub Actions Workflow** (if needed):
   - The workflow file is at `.github/workflows/deploy.yml`
   - It will automatically build and deploy on every push to `main`

4. **Your app will be live at**:
   ```
   https://spraymachine.github.io/sunny/
   ```

### Manual Deployment (Alternative):

If you prefer manual deployment:

```bash
npm run build
# Then use gh-pages or manually upload dist folder
```

**Important**: Make sure your `.env` variables are set as GitHub Secrets if using GitHub Actions, or configure them in your build process.

## 🐛 Troubleshooting

**Blank screen?**
- Check browser console for errors
- Verify `.env` file exists with correct Supabase credentials
- Ensure Supabase project is active and schema is deployed

**Can't login?**
- Verify user exists in Supabase Auth
- Check user has `role = 'admin'` in profiles table
- Check browser console for auth errors

**No data showing?**
- Verify RLS policies are set correctly
- Check user has admin role
- Ensure tables have data (you can add test data via Supabase dashboard)
