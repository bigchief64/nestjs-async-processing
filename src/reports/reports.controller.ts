import { Body, Controller, Post } from '@nestjs/common';
import { ReportJobInput, ReportQueueService } from './report-jobs';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportQueueService) {}

  @Post('generate')
  generate(@Body() body: ReportJobInput) {
    return this.reports.enqueue(body);
  }
}
