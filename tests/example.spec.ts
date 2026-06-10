import { expect, test } from '@nuxt/test-utils/playwright'

test('landing renders the workspace grid', async ({ page, goto }) => {
  // `/` is the game-grid workspace picker (Phase 2). It used to redirect to
  // /live; assert the grid landing instead.
  await goto('/', { waitUntil: 'hydration' })
  await expect(page).toHaveTitle(/Workspaces/)
  await expect(page.getByText('Choose a workspace')).toBeVisible()
})
