import { format, startOfMonth, startOfYear, subDays, subMonths, subYears } from 'date-fns';
import { DATE_FORMAT } from '@/config/constants';

export interface DateRangePreset {
  id: string;
  label: string;
  getRange: () => {
    startDate: string;
    endDate: string;
  };
}

const formatDate = (date: Date) => format(date, DATE_FORMAT);

export const dateRangePresets: DateRangePreset[] = [
  {
    id: 'this-month',
    label: 'This month',
    getRange: () => {
      const now = new Date();
      return {
        startDate: formatDate(startOfMonth(now)),
        endDate: formatDate(now),
      };
    },
  },
  {
    id: 'last-3-months',
    label: 'Last 3 months',
    getRange: () => {
      const now = new Date();
      return {
        startDate: formatDate(subMonths(now, 3)),
        endDate: formatDate(now),
      };
    },
  },
  {
    id: 'last-6-months',
    label: 'Last 6 months',
    getRange: () => {
      const now = new Date();
      return {
        startDate: formatDate(subMonths(now, 6)),
        endDate: formatDate(now),
      };
    },
  },
  {
    id: 'this-year',
    label: 'This year',
    getRange: () => {
      const now = new Date();
      return {
        startDate: formatDate(startOfYear(now)),
        endDate: formatDate(now),
      };
    },
  },
  {
    id: 'last-year',
    label: 'Last year',
    getRange: () => {
      const lastYear = subYears(new Date(), 1);
      return {
        startDate: formatDate(startOfYear(lastYear)),
        endDate: formatDate(subDays(startOfYear(new Date()), 1)),
      };
    },
  },
  {
    id: 'all-time',
    label: 'All time',
    getRange: () => ({
      startDate: '',
      endDate: '',
    }),
  },
];
