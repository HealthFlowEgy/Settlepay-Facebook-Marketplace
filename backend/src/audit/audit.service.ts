import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const REDACTED_FIELDS = ['userToken', 'token', 'apiKey', 'otp', 'password', 'nationalId', 'hpUserToken'];

function sanitize(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const result: any = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = REDACTED_FIELDS.includes(k) ? '[REDACTED]' : sanitize(v);
  }
  return result;
}

interface LogEntry {
  userId?:         string;
  dealId?:         string;
  operation:       string;
  hpOperation?:    string;
  requestSummary?: Record<string, any>;
  responseCode?:   string;
  responseSuccess?: boolean;
  outcome?:        string;
  errorMessage?:   string;
  ipAddress?:      string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: LogEntry) {
    try {
      await this.prisma.auditLog.create({
        data: {
          ...entry,
          requestSummary: entry.requestSummary ? sanitize(entry.requestSummary) : undefined,
          responseCode:   entry.responseSuccess != null ? (entry.responseSuccess ? 'SUCCESS' : 'ERROR') : undefined,
        },
      });
    } catch {
      // Never fail the main flow due to audit logging
    }
  }
}
