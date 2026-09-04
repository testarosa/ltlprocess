# LTL TMS production deployment: resume checklist

Last updated: August 25, 2026

## Current state

- Production URL: `https://ltl.pls-solutionsinc.com/login`
- DNS points `ltl.pls-solutionsinc.com` to `20.115.91.30`.
- IIS serves the frontend and proxies `/api` to the backend at `127.0.0.1:4000`.
- The backend Windows service is `LTLTmsBackend`.
- The HTTPS certificate is working.
- The Microsoft 365 login page appears.
- The remaining login error is `AADSTS50011` because the production redirect URI has not yet been registered in Microsoft Entra.

## Register the Microsoft Entra redirect URI

1. Open <https://entra.microsoft.com/>.
2. Go to **Identity > Applications > App registrations > All applications**.
3. Find the app whose Application (client) ID is:

   `019aef2b-2a68-4c78-a19a-b5af2cc00b36`

4. Open **Authentication**.
5. Under **Platform configurations**, select **Add a platform**.
6. Select **Single-page application**.
7. Add this exact redirect URI:

   `https://ltl.pls-solutionsinc.com/auth-redirect.html`

8. Select **Configure**, then **Save**.

Important:

- Configure it as **Single-page application**, not **Web**.
- Use HTTPS.
- Do not add a trailing slash.
- If the same URI exists under **Web**, remove it there and add it under **Single-page application**.

This portal change does not require rebuilding the application.

## Verify after saving

1. Wait approximately one minute.
2. Open `https://ltl.pls-solutionsinc.com/login` in a new private browser window.
3. Select **Sign in with Microsoft 365**.
4. Complete the company account sign-in.
5. Verify that closing a cancelled sign-in popup restores the **Sign in with Microsoft 365** button.
6. Sign out and verify that the Microsoft popup closes and the application returns to the login page.
7. Test the API through IIS:

   ```powershell
   Invoke-RestMethod https://ltl.pls-solutionsinc.com/api/health
   ```

   Expected result: `ok` is `True`.

## If sign-in still fails

Confirm that the redirect URI shown in the Microsoft error is character-for-character identical to the registered URI. Also confirm that the selected Entra registration has client ID `019aef2b-2a68-4c78-a19a-b5af2cc00b36`.
