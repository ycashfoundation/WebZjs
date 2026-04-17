import initWasm, { initThreadPool, WebWallet } from '@chainsafe/webzjs-wallet';
import initKeys from '@chainsafe/webzjs-keys';
import initRequests from '@chainsafe/webzjs-requests';

const YCASH_MAINNET_LIGHTWALLETD = 'https://lite.ycash.xyz';
const N_THREADS = Math.max(2, Math.min(8, navigator.hardwareConcurrency ?? 4));

// Well-known all-zero-value BIP39 test vector — never hold real funds on this
// seed. Used here because the in-memory wallet is thrown away each page load;
// a fixed mnemonic gives us reproducible behavior across reloads without any
// key management overhead.
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// Blocks before tip to sync. Ycash post-Canopy block time is 75s, so 120 blocks
// ~= 2½ hours of history; sync should complete in well under a minute.
const SYNC_BACKTRACK_BLOCKS = 120;

const logEl = document.getElementById('log');

function log(message, cls = 'pending') {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = message;
  logEl.appendChild(p);
  console.log(message);
}

function showJSON(label, obj) {
  const h = document.createElement('h3');
  h.textContent = label;
  const pre = document.createElement('pre');
  pre.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, replacer, 2);
  logEl.appendChild(h);
  logEl.appendChild(pre);
}

// JSON.stringify can't serialize BigInt by default; WebZjs returns heights as
// BigInt. This keeps the output readable.
function replacer(_k, v) {
  return typeof v === 'bigint' ? v.toString() : v;
}

async function run() {
  const started = performance.now();
  try {
    log(`Initializing wasm (threads=${N_THREADS})…`);
    await initWasm();
    await initKeys();
    await initRequests();
    await initThreadPool(N_THREADS);
    log('wasm + thread pool initialized', 'ok');

    log(`Constructing WebWallet against ${YCASH_MAINNET_LIGHTWALLETD}…`);
    const wallet = new WebWallet('main', YCASH_MAINNET_LIGHTWALLETD, 1, 1, null);
    window.webWallet = wallet;
    log('WebWallet constructed', 'ok');

    log('Step 1/4: wallet.get_latest_block()…');
    const tipStart = performance.now();
    const tip = await wallet.get_latest_block();
    const tipMs = (performance.now() - tipStart).toFixed(0);
    const tipHeight = Number(tip);
    log(`Step 1/4: ok — tip=${tipHeight} (${tipMs}ms)`, 'ok');
    if (tipHeight < 1_100_000) {
      throw new Error(`Tip ${tipHeight} is below Canopy (1_100_006); proxy probably wrong chain`);
    }

    const birthday = tipHeight - SYNC_BACKTRACK_BLOCKS;
    log(`Step 2/4: create_account(birthday=${birthday}, hd_index=0)…`);
    const acctStart = performance.now();
    const accountId = await wallet.create_account('smoke-test', TEST_MNEMONIC, 0, birthday);
    const acctMs = (performance.now() - acctStart).toFixed(0);
    log(`Step 2/4: ok — account_id=${accountId} (${acctMs}ms)`, 'ok');

    log(`Step 3/4: wallet.sync() — scanning ~${SYNC_BACKTRACK_BLOCKS} blocks…`);
    const syncStart = performance.now();
    await wallet.sync();
    const syncMs = (performance.now() - syncStart).toFixed(0);
    log(`Step 3/4: ok — sync completed in ${syncMs}ms`, 'ok');

    log('Step 4/4: wallet.get_wallet_summary()…');
    const summary = await wallet.get_wallet_summary();
    log('Step 4/4: ok — summary fetched', 'ok');
    showJSON('Wallet summary (expected: zero balance, fully scanned through tip)', summary);

    const totalMs = (performance.now() - started).toFixed(0);
    log(`All steps passed in ${totalMs}ms total. Ycash sync pipeline is live.`, 'ok');

    window.smokeResult = {
      ok: true,
      tip: tipHeight,
      birthday,
      accountId: Number(accountId ?? -1),
      syncMs: Number(syncMs),
      totalMs: Number(totalMs),
    };
  } catch (err) {
    log(`FAILED: ${err?.message ?? err}`, 'fail');
    console.error(err);
    const pre = document.createElement('pre');
    pre.textContent = err?.stack ?? String(err);
    logEl.appendChild(pre);
    window.smokeResult = { ok: false, error: String(err) };
  }
}

run();
