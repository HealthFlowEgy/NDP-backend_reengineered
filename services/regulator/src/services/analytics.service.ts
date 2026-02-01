export class AnalyticsService {
  async getDashboardStats() {
    return {
      prescriptions: { today: 15000, total: 8000000 },
      dispenses: { today: 12000, total: 7000000 },
      activeRecalls: 2,
      openAlerts: 5,
    };
  }

  async getPrescriptionTrends(period: string, days: number) {
    return Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.now() - i * 86400000).toISOString().split('T')[0],
      count: 10000 + Math.floor(Math.random() * 5000),
    }));
  }

  async getMedicationAnalytics(params: any) {
    return { totalPrescribed: 50000, topPrescribers: [] };
  }

  async getPractitionerAnalytics(license: string) {
    return { license, prescriptionCount: 500, complianceScore: 98 };
  }
}

export const analyticsService = new AnalyticsService();
