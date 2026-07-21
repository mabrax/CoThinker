import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

test('completes the local co-thinking loop and preserves accepted work', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, openaiConfigured: false }),
    }),
  )

  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'CoThinker' })).toBeVisible()
  await expect(page.getByTestId('canvas-board')).toHaveAttribute(
    'data-canvas-ready',
    'true',
  )
  await expect(page.getByText('Local voice and demo mode are ready')).toBeVisible()

  await page.getByTestId('run-demo').click()

  await expect(page.getByTestId('transcript')).toContainText(
    'I created a complete co-thinking loop',
  )
  await expect(page.getByTestId('document-sections')).toContainText(
    'Realtime co-thinking architecture',
  )

  const demoState = await page.evaluate(() => window.__cothinker?.getState())
  expect(demoState).toBeDefined()
  const demoLabels = demoState?.scene.elements.map((element) =>
    element.label?.replace(/\s+/g, ' '),
  )
  expect(demoLabels).toEqual(
    expect.arrayContaining([
      'Human collaborator',
      'Realtime voice agent',
      'Shared session state',
      'Reasoning delegate',
      'Durable design document',
    ]),
  )
  expect(demoState?.sections.at(-1)).toMatchObject({
    title: 'Realtime co-thinking architecture',
    source: 'demo',
  })
  expect(demoState?.sections.at(-1)?.elementIds).toHaveLength(5)

  await page.getByLabel('Speak or type a design move').fill('Add an archivist agent')
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByTestId('transcript')).toContainText(
    'I added “archivist agent” as a reversible AI proposal.',
  )
  await expect(page.getByTestId('canvas-board')).not.toHaveAttribute(
    'data-selected-ids',
    '',
  )

  await page.getByLabel('Section title').fill('Accepted archival role')
  await page.getByTestId('promote-selection').click()
  await expect(page.getByTestId('document-sections')).toContainText(
    'Accepted archival role',
  )

  const finalState = await page.evaluate(() => window.__cothinker?.getState())
  expect(
    finalState?.scene.elements.map((element) =>
      element.label?.replace(/\s+/g, ' '),
    ),
  ).toContain(
    'archivist agent',
  )
  expect(finalState?.sections).toHaveLength(2)
  expect(finalState?.sections[1]).toMatchObject({
    title: 'Accepted archival role',
    source: 'human',
  })

  await page.getByRole('button', { name: 'Clear AI proposals' }).click()
  const clearedState = await page.evaluate(() => window.__cothinker?.getState())
  const clearedLabels = clearedState?.scene.elements.map((element) =>
    element.label?.replace(/\s+/g, ' '),
  )
  expect(clearedLabels).toContain('Human collaborator')
  expect(clearedLabels).not.toContain('archivist agent')
  expect(clearedState?.sections).toHaveLength(2)

  await page.getByRole('button', { name: 'New session' }).click()
  await expect(page.getByTestId('document-sections')).toContainText(
    'No accepted decisions yet.',
  )
  const resetState = await page.evaluate(() => window.__cothinker?.getState())
  expect(resetState?.sections).toEqual([])
  expect(resetState?.transcript).toEqual([])
  expect(consoleErrors).toEqual([])
})
