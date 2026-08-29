/**
 * Экраны оператора с собственной нижней навигацией не должны одновременно
 * получать общую панель из layout: фиксированные панели перекрывают рабочие
 * действия и делают их недоступными для мыши и сенсорного ввода.
 */
export function operatorRouteOwnsNavigation(pathname: string): boolean {
  return pathname === '/operator/v2'
    || pathname.startsWith('/operator/v2/')
    || pathname === '/operator/v3'
    || pathname.startsWith('/operator/v3/');
}
