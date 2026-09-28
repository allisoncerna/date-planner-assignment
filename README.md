# Date & Hangout Planner

A full-stack date and hangout planner for collecting ideas, sorting them by how likely they are to happen, and checking them off once you've done them. The frontend is a static HTML/CSS/JavaScript app, with Supabase providing authentication and the database.

## Live App

**Netlify URL:** https://date-planner-assignment.netlify.app/

## Technologies

- HTML
- Tailwind CSS (Play CDN) and custom CSS
- JavaScript
- Supabase Auth and Postgres
- Netlify (static hosting)

## Demo

**Unlisted YouTube demo:** TODO: add the video URL before submitting.

## Features

- **Email/password auth**: register, log in, log out, with the session kept across reloads
- **Add date ideas**: title, category (with suggestions like Coffee, Dinner, Outdoors), and status
- **Board view**: ideas are grouped into *Wishlist*, *Maybe*, and *Definite* columns
- **Quick actions**: mark an idea done or not done, change its status, or delete it
- **Filters and stats**: show all ideas, only open ones, or only completed ones, plus summary counts
- **Handles errors**: friendly messages, loading states, and changes that roll back if a save fails
- **Private per user**: Row Level Security means each user only ever sees their own data

## Project structure

```
.
├── index.html          # Auth screen + dashboard markup
├── app.js              # Supabase client, auth, CRUD, rendering
├── styles.css          # Warm theme + component styles
├── schema.sql          # Table, index, and RLS policies
├── config.example.js   # Template for runtime config (copy to config.js)
├── .env.example        # Template for deployment environment variables
└── README.md
```

## Setup

### 1. Create a Supabase project

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste in the contents of [`schema.sql`](schema.sql), and click **Run**.
   This creates the `dates` table, an index, and Row Level Security policies.

**Table: `dates`**

| Column         | Type        | Notes                                           |
| -------------- | ----------- | ----------------------------------------------- |
| `id`           | uuid        | Primary key, `gen_random_uuid()`                |
| `user_id`      | uuid        | References `auth.users`, cascades on delete     |
| `title`        | text        | 1–120 characters                                |
| `category`     | text        | 1–40 characters, e.g. Coffee, Outdoors, Dinner  |
| `status`       | text        | One of `Wishlist`, `Maybe`, `Definite`          |
| `is_completed` | boolean     | Defaults to `false`                             |
| `created_at`   | timestamptz | Defaults to `now()`                             |

### 2. Configure authentication

In **Authentication → URL Configuration**, set the **Site URL** to where the app runs (for example `http://localhost:5500`) and add it to **Redirect URLs**. This makes email confirmation links point back to the app.

Email confirmation is optional. You can turn it off under **Authentication → Providers → Email** if you want new users logged in straight away.

### 3. Add your credentials

Get your **Project URL** and **publishable (or legacy anon public) key** from **Project Settings → API**. The browser app uses the publishable/anon key; never use a `service_role` or secret key here.

```bash
cp config.example.js config.js
```

Fill in `config.js` with your project values:

```js
// config.js
window.ENV = {
  SUPABASE_URL: 'https://abcd1234.supabase.co',
  SUPABASE_ANON_KEY: 'your-publishable-or-anon-key',
};
```

> `config.js` is loaded by the browser and is gitignored. `.env.example` documents the same variable names for hosting configuration; a static browser app does not load `.env` itself.

> **Security:** publishable/anon keys are intended for client use. Row Level Security in `schema.sql` protects user data. **Never** use a `service_role` or secret key in this app.

### 4. Run it locally

Any static file server works. Opening `index.html` directly from disk (`file://`) won't work because of auth redirects.

```bash
npx serve .                 # Node
# or
python -m http.server 5500  # Python
```

You can also use the VS Code **Live Server** extension. Then open the URL it prints.

## Deploying to Netlify

Connect the GitHub repository to Netlify and set the publish directory to `.`. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` under **Site configuration → Environment variables**, then set this build command to generate the browser config:

```bash
printf "window.ENV = { SUPABASE_URL: '%s', SUPABASE_ANON_KEY: '%s' };\n" "$SUPABASE_URL" "$SUPABASE_ANON_KEY" > config.js
```

After deployment, add the Netlify URL to Supabase **Authentication → URL Configuration** as the Site URL and a Redirect URL. Replace the TODO in **Live App** above with the deployed URL.

### Production notes

- **Tailwind Play CDN:** `cdn.tailwindcss.com` compiles styles in the browser and logs a console warning for production use. That's fine for small apps. For best performance, swap it for a compiled stylesheet built with the [Tailwind CLI](https://tailwindcss.com/docs/installation) and keep the same color and font config.
- **Supabase SDK version:** the SDK loads from jsDelivr as `@supabase/supabase-js@2`. To pin an exact version, change the tag in `index.html` (for example `@2.45.0`).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Setup needed" screen | `config.js` is missing or still has placeholder values. |
| "Can't reach the server" | Check `SUPABASE_URL` and your connection. |
| Signed up but can't log in | Confirm your email first, or turn off email confirmation. |
| "You don't have permission to do that" | RLS policies are missing. Re-run `schema.sql`. |
| Confirmation link opens the wrong site | Update **Site URL** / **Redirect URLs** in Supabase. |

## License

MIT
