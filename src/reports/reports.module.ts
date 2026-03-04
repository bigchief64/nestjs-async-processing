import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import {
  ReportProcessor,
  ReportQueueService,
  ReportStateStore,
} from './report-jobs';

@Module({
  controllers: [ReportsController],
  providers: [ReportStateStore, ReportProcessor, ReportQueueService],
})
export class ReportsModule {}
