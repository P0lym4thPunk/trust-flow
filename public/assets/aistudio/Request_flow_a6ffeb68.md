Request flow
1. Browser sends user message to a server-side AI endpoint.
2. Server authenticates user and loads only the minimum authorised context.
3. Server sends TrustFlow system instructions, relevant product knowledge and untrusted user content to Gemini.
4. Model returns a structured draft or clarification request.
5. Server parses and validates output with a schema library and business rules.
6. Server returns a safe, typed result to the frontend.
7. User reviews and confirms the agreement.
8. Backend persists off-chain agreement metadata in Supabase.
9. Frontend requests a transaction preparation payload from trusted server code or builds a transaction using verified SDK methods.
10. User's wallet displays and signs the transaction.
11. Transaction is submitted to Stellar testnet.
12. App checks transaction confirmation and contract state.
13. Verified state/event is indexed into Supabase for UI convenience.
14. UI displays the result and a Stellar explorer link.