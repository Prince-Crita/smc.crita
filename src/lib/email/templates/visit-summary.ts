/**
 * Visit Summary Email Template
 * Generates rich HTML email for visit close notification
 */

export interface VisitSummaryEmailData {
  visitNumber: string;
  clientName: string;
  executiveName: string;
  scheduledDate: string;
  closedAt: string;
  progress: number;
  totalTasks: number;
  completedTasks: number;
  totalSubtasks: number;
  completedSubtasks: number;
  carryForwardCount: number;
  rating?: string;
  notes?: string;
  tasks: Array<{
    title: string;
    status: string;
    completedSubtasks: number;
    totalSubtasks: number;
  }>;
}

export function generateVisitSummaryEmail(data: VisitSummaryEmailData): string {
  const ratingColor =
    data.rating === "Excellent" ? "#10b981" :
    data.rating === "Satisfactory" ? "#3b82f6" :
    data.rating === "Needs Improvement" ? "#f59e0b" : "#ef4444";

  const tasksHtml = data.tasks.map(t => `
    <tr>
      <td style="padding: 10px 12px; border-bottom: 1px solid #1e293b; color: #e2e8f0; font-size: 13px;">${t.title}</td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #1e293b; text-align: center; font-size: 13px;">
        <span style="background: ${t.status === 'COMPLETED' ? '#10b981' : t.status === 'PARTIALLY_COMPLETED' ? '#f59e0b' : '#ef4444'}22; 
              color: ${t.status === 'COMPLETED' ? '#10b981' : t.status === 'PARTIALLY_COMPLETED' ? '#f59e0b' : '#ef4444'};
              padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600;">
          ${t.status.replace(/_/g, ' ')}
        </span>
      </td>
      <td style="padding: 10px 12px; border-bottom: 1px solid #1e293b; text-align: center; color: #94a3b8; font-size: 13px;">
        ${t.completedSubtasks}/${t.totalSubtasks}
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Visit Closed — ${data.visitNumber}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 24px 16px;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #1e293b 100%); border-radius: 16px 16px 0 0; padding: 28px 32px; border: 1px solid #334155; border-bottom: none;">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <div style="width: 40px; height: 40px; background: #3b82f6; border-radius: 10px; display: flex; align-items: center; justify-content: center;">
          <span style="color: white; font-size: 18px; font-weight: 700;">✓</span>
        </div>
        <div>
          <p style="margin: 0; color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">SMC Audit System</p>
          <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 700;">Visit Closed</h1>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div style="background: #1e293b; padding: 32px; border: 1px solid #334155; border-top: none; border-bottom: none;">
      
      <!-- Visit Info -->
      <div style="background: #0f172a; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #334155;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 12px; width: 40%;">Visit Number</td>
            <td style="padding: 6px 0; color: #f1f5f9; font-size: 13px; font-weight: 600;">${data.visitNumber}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 12px;">Client</td>
            <td style="padding: 6px 0; color: #f1f5f9; font-size: 13px; font-weight: 600;">${data.clientName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 12px;">Executive</td>
            <td style="padding: 6px 0; color: #f1f5f9; font-size: 13px;">${data.executiveName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 12px;">Scheduled Date</td>
            <td style="padding: 6px 0; color: #f1f5f9; font-size: 13px;">${data.scheduledDate}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 12px;">Closed At</td>
            <td style="padding: 6px 0; color: #10b981; font-size: 13px; font-weight: 600;">${data.closedAt}</td>
          </tr>
        </table>
      </div>

      <!-- Stats Row -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px;">
        <div style="background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 16px; text-align: center;">
          <p style="margin: 0; color: #10b981; font-size: 24px; font-weight: 700;">${data.progress}%</p>
          <p style="margin: 4px 0 0; color: #64748b; font-size: 11px;">Completion</p>
        </div>
        <div style="background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 16px; text-align: center;">
          <p style="margin: 0; color: #3b82f6; font-size: 24px; font-weight: 700;">${data.completedSubtasks}/${data.totalSubtasks}</p>
          <p style="margin: 4px 0 0; color: #64748b; font-size: 11px;">Subtasks Done</p>
        </div>
        <div style="background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 16px; text-align: center;">
          <p style="margin: 0; color: #f59e0b; font-size: 24px; font-weight: 700;">${data.carryForwardCount}</p>
          <p style="margin: 4px 0 0; color: #64748b; font-size: 11px;">Carry Forwards</p>
        </div>
      </div>

      ${data.rating ? `
      <!-- Rating -->
      <div style="background: ${ratingColor}11; border: 1px solid ${ratingColor}33; border-radius: 12px; padding: 16px; margin-bottom: 24px; text-align: center;">
        <p style="margin: 0; color: #94a3b8; font-size: 12px;">Overall Rating</p>
        <p style="margin: 4px 0 0; color: ${ratingColor}; font-size: 20px; font-weight: 700;">${data.rating}</p>
      </div>
      ` : ''}

      <!-- Tasks Breakdown -->
      <div style="margin-bottom: 24px;">
        <h3 style="color: #e2e8f0; font-size: 14px; font-weight: 600; margin: 0 0 12px;">Task Breakdown</h3>
        <div style="border: 1px solid #334155; border-radius: 12px; overflow: hidden;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #0f172a;">
                <th style="padding: 10px 12px; text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Task</th>
                <th style="padding: 10px 12px; text-align: center; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Status</th>
                <th style="padding: 10px 12px; text-align: center; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Progress</th>
              </tr>
            </thead>
            <tbody>${tasksHtml}</tbody>
          </table>
        </div>
      </div>

      ${data.notes ? `
      <!-- Notes -->
      <div style="background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 16px;">
        <p style="margin: 0 0 6px; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Notes</p>
        <p style="margin: 0; color: #e2e8f0; font-size: 13px; line-height: 1.6;">${data.notes}</p>
      </div>
      ` : ''}

    </div>

    <!-- Footer -->
    <div style="background: #0f172a; border: 1px solid #334155; border-top: none; border-radius: 0 0 16px 16px; padding: 20px 32px; text-align: center;">
      <p style="margin: 0; color: #475569; font-size: 12px;">This is an automated email from <strong style="color: #64748b;">SMC Audit System</strong></p>
      <p style="margin: 4px 0 0; color: #334155; font-size: 11px;">Please do not reply to this email</p>
    </div>

  </div>
</body>
</html>`;
}
