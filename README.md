# Meta GHL Lead Matcher

A no-install browser tool for matching Meta lead CSV exports against GHL / HighLevel contact exports.

This version does **not** require Python, Streamlit, `pip install`, or terminal commands.

You can either:

1. Open `index.html` directly on your computer, or
2. Upload the files to GitHub and turn on GitHub Pages.

## Recommended repository name

```text
meta-ghl-lead-matcher
```

## What this tool does

- Upload Meta leads CSV
- Upload GHL / HighLevel leads CSV
- Auto-detect:
  - Email column
  - Phone column
  - Full name column
  - First name and last name columns
- Normalize phone numbers
- Normalize emails
- Compare names using a similarity score
- Export:
  - Manual review CSV
  - Full match report CSV

## Best use case

Use this when you want to check whether Meta leads properly made it into GHL / HighLevel.

This is helpful when:

- GHL has missing leads
- Zapier or automations may have failed
- Lead forms changed
- Phone or email formatting is inconsistent
- You need a manual review list instead of checking every lead one by one

## Matching logic

The app checks each Meta lead against the GHL export.

It flags a lead for manual review when:

- There is no phone or email match in GHL
- Only the phone matches
- Only the email matches
- Phone and/or email match but the name looks different
- The name similarity score is below the selected threshold

Default name similarity threshold: `75%`

## How to use locally

No installation needed.

1. Download the files.
2. Open `index.html` in your browser.
3. Upload your Meta CSV.
4. Upload your GHL CSV.
5. Click `Run Match`.
6. Download the manual review CSV.

## How to use with GitHub Pages

1. Create a new GitHub repository named:

```text
meta-ghl-lead-matcher
```

2. Upload all files from this folder.
3. Go to the repository settings.
4. Open `Pages`.
5. Set source to deploy from the main branch and root folder.
6. Save.
7. Open the GitHub Pages link.

After that, you can just open the link in your browser.

## Privacy

This is a static browser app.

Your CSV files are processed in your browser only. They are not sent to a database by this code.

## Important note

Because this version has no backend, it exports CSV files only, not Excel `.xlsx` files.

CSV files can still be opened in Google Sheets, Excel, or Numbers.
