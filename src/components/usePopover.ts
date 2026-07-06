import { useEffect, useLayoutEffect, useState, type RefObject, type CSSProperties } from 'react'

/**
 * Calcula um estilo `position: fixed` para um popover ancorado a um elemento,
 * virando para CIMA quando não há espaço embaixo. Como é `fixed` + portal,
 * o popover escapa de qualquer container com overflow (ex.: modal com rolagem).
 */
export function useAnchoredStyle(
  open: boolean,
  anchor: RefObject<HTMLElement>,
  opts?: { height?: number; matchWidth?: boolean; width?: number },
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' })
  const est = opts?.height ?? 300
  const matchWidth = opts?.matchWidth ?? false
  const width = opts?.width

  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    function update() {
      const el = anchor.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const abaixo = window.innerHeight - r.bottom
      const paraCima = abaixo < est && r.top > abaixo
      const base: CSSProperties = {
        position: 'fixed',
        left: Math.max(8, Math.min(r.left, window.innerWidth - (matchWidth ? r.width : width ?? 288) - 8)),
        width: matchWidth ? r.width : width,
        zIndex: 70,
      }
      if (paraCima) {
        base.bottom = window.innerHeight - r.top + 4
        base.maxHeight = r.top - 12
      } else {
        base.top = r.bottom + 4
        base.maxHeight = abaixo - 12
      }
      setStyle(base)
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, anchor, est, matchWidth, width])

  return style
}

/** Fecha ao clicar fora — considerando o gatilho E o popover (que está num portal). */
export function useDismiss(open: boolean, onClose: () => void, refs: RefObject<HTMLElement>[]) {
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      const t = e.target as Node
      for (const r of refs) if (r.current && r.current.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
    // refs são estáveis; não incluir para evitar re-registro a cada render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose])
}
