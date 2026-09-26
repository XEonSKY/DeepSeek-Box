# Models & Balances

“Settings → Models” lists the models offered by the dsh providers together with their balances. The data is read and queried by the main process; the page **never displays any key**.

## First visit: consent comes first

On the first visit the page shows a consent card explaining that it will read `cordis.patch.yml` (provider config) and `.credentials.yaml` (API keys) under the dsh configuration directory (`$DSH_HOME`, or `~/.dsh` when unset) and use the saved keys to query the provider endpoints for the model catalogue and balances.

- Clicking “Agree and read” is what starts reading and network access; the consent is stored locally (as `modelsCredConsent` in `settings.json` under the configuration directory) and is not asked again;
- Clicking “Not now” collapses the card for this visit; the page then shows “Not authorized yet” and you can authorize at any time;
- Before consent, the page **reads nothing and makes no network requests**.

## The three columns

| Column | Description |
|---|---|
| **Model** | The model identifier offered by the provider; when a provider does not publish a catalogue, the models declared in the configuration are used. |
| **Provider** | The service the model belongs to. **One token counts as one provider**: routes that resolve to the same key are merged into a single group and shown only once. |
| **Balance** | The current balance. Only official DeepSeek domains can be queried (via `/user/balance`); other providers show “not supported”, providers without a key show “no key configured”, and query failures show the reason. |

Hovering over a balance shows the granted / topped-up breakdown.

## Refresh all

The “Refresh all” button in the toolbar re-reads the configuration and queries every provider's model catalogue and balance over the network; the model count is shown alongside. If the configuration file is missing or unparsable, or no provider is configured, the page shows the corresponding hint.

## Privacy

- Keys in `.credentials.yaml` are read only by the **main process** and used solely to call the matching provider endpoint;
- Keys never enter IPC return values, page content or logs;
- Requests originate from this machine only; results are for display and are not written to logs or sent anywhere else.

## Relationship to the status-bar balance

The balance item on the right of the status bar shows the balance of the provider behind the **current default model**: once authorized it refreshes automatically every 5 minutes while in the foreground, and clicking refreshes manually; before authorization it shows “Click to authorize”, which jumps to this page.
