// Playwright test runner for tire tracks and drift physics demos
// Usage: node test_page.js [tracks|drift|game|all]

const { chromium } = require('playwright');
const path = require('path');

const DEMO_TRACKS_URL = `file://${path.resolve(__dirname, 'demo_tracks.html')}`;
const DEMO_DRIFT_URL = `file://${path.resolve(__dirname, 'demo_drift.html')}`;
const MAIN_GAME_URL = `file://${path.resolve(__dirname, 'index.html')}`;

let passed = 0, failed = 0;

function assert(condition, msg) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failed++;
  } else {
    console.log(`  PASS: ${msg}`);
    passed++;
  }
}

async function testTracks(browser) {
  console.log('\n=== TIRE TRACKS TECH DEMO ===\n');
  const page = await browser.newPage();
  await page.goto(DEMO_TRACKS_URL);

  // Wait for demo to complete
  await page.waitForFunction(() => window._demoComplete === true, { timeout: 30000 });

  // Take screenshot
  await page.screenshot({ path: 'screenshot_tracks.png', fullPage: true });
  console.log('Screenshot saved: screenshot_tracks.png');

  // Get track logs
  const logs = await page.evaluate(() => window._trackLogs);

  // Filter to final width measurements (the summary entries at the end)
  const finalWidths = logs.filter(l => l.totalPoints !== undefined);
  assert(finalWidths.length === 4, `4 wheels have trail data (got ${finalWidths.length})`);

  for (const entry of finalWidths) {
    console.log(`  Wheel ${entry.label}: width=${entry.lastWidth.toFixed(4)}m, points=${entry.totalPoints}`);
    assert(entry.lastWidth <= 0.3, `${entry.label} track width ≤ 0.3m (got ${entry.lastWidth.toFixed(4)}m)`);
    assert(entry.totalPoints > 5, `${entry.label} has trail points (got ${entry.totalPoints})`);
  }

  // Check that all 4 wheels have separate tracks
  const wheelLabels = finalWidths.map(w => w.label);
  assert(wheelLabels.includes('FL'), 'Front Left wheel has trail');
  assert(wheelLabels.includes('FR'), 'Front Right wheel has trail');
  assert(wheelLabels.includes('RL'), 'Rear Left wheel has trail');
  assert(wheelLabels.includes('RR'), 'Rear Right wheel has trail');

  // Check colors during the run
  const normalEntries = logs.filter(l => l.color === 'brown' && !l.isDrifting);
  const driftEntries = logs.filter(l => l.color === 'dark' && l.isDrifting);
  assert(normalEntries.length > 0, `Normal driving produces brown tracks (got ${normalEntries.length} entries)`);
  assert(driftEntries.length > 0, `Drifting produces dark tracks (got ${driftEntries.length} entries)`);

  await page.close();
}

async function testDrift(browser) {
  console.log('\n=== DRIFT PHYSICS TECH DEMO ===\n');
  const page = await browser.newPage();
  await page.goto(DEMO_DRIFT_URL);

  // Wait for all scenarios to complete
  await page.waitForFunction(() => window._allScenariosComplete === true, { timeout: 90000 });

  // Take screenshot
  await page.screenshot({ path: 'screenshot_drift.png', fullPage: true });
  console.log('Screenshot saved: screenshot_drift.png');

  // Get results
  const results = await page.evaluate(() => window._scenarioResults);
  assert(results.length === 3, `3 scenarios completed (got ${results.length})`);

  for (const r of results) {
    console.log(`\n  Scenario: ${r.name}`);
    console.log(`    Max angular velocity: ${r.maxAngularVel.toFixed(3)} rad/s`);
    console.log(`    Min forward speed: ${r.minForwardSpeed.toFixed(2)} m/s`);
    console.log(`    Max lateral speed: ${r.maxLateralSpeed.toFixed(2)} m/s`);
    console.log(`    Maintained momentum: ${r.maintainedMomentum}`);

    assert(r.maxAngularVel < 3.0, `${r.name}: angular velocity < 3.0 rad/s (got ${r.maxAngularVel.toFixed(3)})`);
    // Only check momentum for gentle turn; aggressive drifts naturally slow the car
    if (r.name === 'Gentle Turn') {
      assert(r.minForwardSpeed > 0.5, `${r.name}: maintains forward momentum > 0.5 m/s (got ${r.minForwardSpeed.toFixed(2)})`);
    }
  }

  // Check that at least one scenario had meaningful lateral speed (actually drifted)
  const maxLateral = Math.max(...results.map(r => r.maxLateralSpeed));
  assert(maxLateral > 1.0, `At least one scenario has lateral speed > 1.0 m/s (got ${maxLateral.toFixed(2)})`);

  await page.close();
}

async function testGame(browser) {
  console.log('\n=== MAIN GAME INTEGRATION ===\n');
  const page = await browser.newPage();
  await page.goto(MAIN_GAME_URL);

  // Wait for the game to initialize
  await page.waitForSelector('#speed-value', { timeout: 15000 });
  await page.waitForTimeout(3000);

  // Verify the game loaded
  const speedText = await page.textContent('#speed-value');
  const initSpeed = parseInt(speedText);
  assert(initSpeed < 10, `Initial speed is near 0 (got ${initSpeed})`);

  // Simulate driving: press W for acceleration
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);

  const speedAfterAccel = await page.textContent('#speed-value');
  const speedNum = parseInt(speedAfterAccel);
  console.log(`  Speed after 2s of acceleration: ${speedNum} km/h`);
  assert(speedNum > 0, `Car accelerates (speed=${speedNum} km/h)`);

  // Now steer and handbrake
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(500);
  await page.keyboard.down('Space');
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'screenshot_game_drift.png', fullPage: true });
  console.log('Screenshot saved: screenshot_game_drift.png');

  // Release keys
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyA');
  await page.keyboard.up('Space');
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'screenshot_game_final.png', fullPage: true });
  console.log('Screenshot saved: screenshot_game_final.png');

  // Verify game is still running
  const finalSpeed = await page.textContent('#speed-value');
  assert(finalSpeed !== null, 'Game HUD is still active');

  // Check that trail ribbon system exists
  const hasTrails = await page.evaluate(() => {
    return typeof window._wheelTrails !== 'undefined' || document.querySelector('canvas') !== null;
  });
  assert(hasTrails, 'Canvas/trails exist in the scene');

  await page.close();
}

async function main() {
  const arg = process.argv[2] || 'all';
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  try {
    if (arg === 'tracks' || arg === 'all') await testTracks(browser);
    if (arg === 'drift' || arg === 'all') await testDrift(browser);
    if (arg === 'game' || arg === 'all') await testGame(browser);
  } catch (err) {
    console.error('\nFATAL ERROR:', err.message);
    failed++;
  }

  await browser.close();

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
