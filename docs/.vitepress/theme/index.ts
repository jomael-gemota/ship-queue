import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { useRoute } from 'vitepress'
import { nextTick, onMounted, watch } from 'vue'
import mediumZoom, { type Zoom } from 'medium-zoom'
import './custom.css'

// Make content screenshots click-to-zoom (fullscreen overlay) via medium-zoom.
// VitePress is an SPA, so we (re)bind images on mount and after every in-app
// route change, targeting only images inside the rendered markdown (.vp-doc)
// to leave the logo, hero, and feature-card icons alone.
const theme: Theme = {
  extends: DefaultTheme,
  setup() {
    const route = useRoute()
    let zoom: Zoom | undefined

    const setupZoom = () => {
      if (!zoom) {
        zoom = mediumZoom({ background: 'var(--vp-c-bg)', margin: 24 })
      }
      zoom.detach()
      zoom.attach('.vp-doc img:not(a img)')
    }

    onMounted(() => nextTick(setupZoom))
    watch(
      () => route.path,
      () => nextTick(setupZoom),
    )
  },
}

export default theme
