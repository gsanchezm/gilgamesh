// planes view copy (Group B). Prefix "planes." — pre-registered in i18n/index.ts, so filling this
// module needs NO edit to any shared file. es/en are authored key-for-key (the index.test.ts parity
// test asserts identical key sets per module).
import type { ViewDict } from './dict';

const planes: ViewDict = {
  es: {
    'planes.title': 'Planes y precios',
    'planes.subtitle': 'Edita el pricing público. El margen se calcula con el costo de infraestructura promedio por cliente.',
    'planes.publish': 'Publicar cambios',
    'planes.published': 'Cambios de precios publicados',
    'planes.badge_publico': 'Público',
    'planes.badge_ventas': 'Ventas',
    'planes.price_label': 'Precio mensual (USD)',
    'planes.contract_label': 'Contrato promedio (USD)',
    'planes.price_aria': 'Precio del plan',
    'planes.cost_label': 'Costo est. / cliente',
    'planes.margin_label': 'Margen bruto',
    // Features (below-the-fold ones invented sensibly; the visible lines match capture 18).
    'planes.f_team_1': '5 seats · 1,000 Runs 30d',
    'planes.f_team_2': '3 Agentes · email',
    'planes.f_team_3': 'Reportes y base de conocimiento',
    'planes.f_biz_1': '20 seats · 5,000 Runs 30d',
    'planes.f_biz_2': '11 Agentes · priority',
    'planes.f_biz_3': 'Integraciones CI/CD',
    'planes.f_biz_4': 'SSO y registro de auditoría',
    'planes.f_ent_1': 'Seats ilimitados · Runs a medida',
    'planes.f_ent_2': '11 Agentes · dedicado',
    'planes.f_ent_3': 'SLA y soporte dedicado',
    'planes.f_ent_4': 'Despliegue on-prem / VPC',
  },
  en: {
    'planes.title': 'Plans & pricing',
    'planes.subtitle': 'Edit public pricing. Margin is computed from the average per-customer infrastructure cost.',
    'planes.publish': 'Publish changes',
    'planes.published': 'Pricing changes published',
    'planes.badge_publico': 'Public',
    'planes.badge_ventas': 'Sales',
    'planes.price_label': 'Monthly price (USD)',
    'planes.contract_label': 'Average contract (USD)',
    'planes.price_aria': 'Plan price',
    'planes.cost_label': 'Est. cost / customer',
    'planes.margin_label': 'Gross margin',
    'planes.f_team_1': '5 seats · 1,000 Runs 30d',
    'planes.f_team_2': '3 Agents · email',
    'planes.f_team_3': 'Reports & knowledge base',
    'planes.f_biz_1': '20 seats · 5,000 Runs 30d',
    'planes.f_biz_2': '11 Agents · priority',
    'planes.f_biz_3': 'CI/CD integrations',
    'planes.f_biz_4': 'SSO & audit log',
    'planes.f_ent_1': 'Unlimited seats · custom Runs',
    'planes.f_ent_2': '11 Agents · dedicated',
    'planes.f_ent_3': 'SLA & dedicated support',
    'planes.f_ent_4': 'On-prem / VPC deployment',
  },
};

export default planes;
