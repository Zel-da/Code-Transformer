import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGetReport, useListReportComments } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { Ionicons } from "@expo/vector-icons";

const QC_STATUS_COLORS: Record<string, string> = {
  OPEN:           "#f59e0b",
  IN_REVIEW:      "#3b82f6",
  PENDING_COLLAB: "#8b5cf6",
  RESOLVED:       "#10b981",
  APPROVED:       "#22c55e",
  ERP_SYNCED:     "#6b7280",
};

const QC_STATUS_LABELS: Record<string, string> = {
  OPEN:           "접수",
  IN_REVIEW:      "QC 검토",
  PENDING_COLLAB: "협업 요청",
  RESOLVED:       "조치 완료",
  APPROVED:       "승인 완료",
  ERP_SYNCED:     "ERP 등록",
};

function Row({
  label,
  value,
  colors,
}: {
  label: string;
  value: string | null | undefined;
  colors: ReturnType<typeof useColors>;
}) {
  if (!value) return null;
  return (
    <View style={rowStyles.row}>
      <Text style={[rowStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[rowStyles.value, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    gap: 12,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  value: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 2,
    textAlign: "right",
  },
});

export default function ReportDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: report, isLoading, isError } = useGetReport(Number(id));
  const { data: comments = [] } = useListReportComments(Number(id));

  const s = makeStyles(colors, topPad, bottomPad);

  if (isLoading) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError || !report) {
    return (
      <View style={[s.center, { backgroundColor: colors.background }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.destructive} />
        <Text style={s.errorText}>보고서를 불러올 수 없습니다.</Text>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backBtnText}>돌아가기</Text>
        </Pressable>
      </View>
    );
  }

  const qcStatus = (report.qcStatus ?? "OPEN") as string;
  const statusColor = QC_STATUS_COLORS[qcStatus] ?? colors.mutedForeground;
  const statusLabel = QC_STATUS_LABELS[qcStatus] ?? qcStatus;
  const reportDate = new Date(report.reportDate).toLocaleString("ko-KR");

  return (
    <ScrollView
      style={[s.root, { backgroundColor: colors.background }]}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={s.topBar}>
        <Pressable style={s.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>
            {report.ncrNumber ?? `보고서 #${report.id}`}
          </Text>
          {report.ncrNumber && (
            <Text style={[s.headerSub, { color: colors.mutedForeground }]}>
              #{report.id}
            </Text>
          )}
        </View>
        <View
          style={[
            s.statusBadge,
            { backgroundColor: statusColor + "20", borderColor: statusColor + "40" },
          ]}
        >
          <Text style={[s.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {/* 기본 정보 */}
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={s.cardTitle}>기본 정보</Text>
        <View style={s.divider} />
        <Row label="품목 코드" value={report.itemCode} colors={colors} />
        <View style={[s.divider, { opacity: 0.5 }]} />
        <Row label="공정명" value={report.processName} colors={colors} />
        <View style={[s.divider, { opacity: 0.5 }]} />
        <Row label="불량 유형" value={report.defectType} colors={colors} />
        <View style={[s.divider, { opacity: 0.5 }]} />
        <Row label="등록일시" value={reportDate} colors={colors} />
        {report.defectQty != null && (
          <>
            <View style={[s.divider, { opacity: 0.5 }]} />
            <Row label="불량 수량" value={String(report.defectQty)} colors={colors} />
          </>
        )}
        {report.registrantName && (
          <>
            <View style={[s.divider, { opacity: 0.5 }]} />
            <Row label="등록자" value={report.registrantName} colors={colors} />
          </>
        )}
        {report.deptCd && (
          <>
            <View style={[s.divider, { opacity: 0.5 }]} />
            <Row label="귀책부서 코드" value={report.deptCd} colors={colors} />
          </>
        )}
      </View>

      {/* 부적합 내용 */}
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={s.cardTitle}>부적합 내용</Text>
        <View style={s.divider} />
        <Text style={s.descText}>{report.description}</Text>
      </View>

      {/* 첨부 사진 */}
      {report.imageUrl && (
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={s.cardTitle}>첨부 사진</Text>
          <View style={s.divider} />
          <Image
            source={{ uri: `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/storage/objects/${report.imageUrl}` }}
            style={s.image}
            resizeMode="cover"
          />
        </View>
      )}

      {/* QC 조치 결과 */}
      {report.qcAction && (
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={s.cardTitle}>QC 조치 결과</Text>
          <View style={s.divider} />
          <Text style={s.descText}>{report.qcAction}</Text>
          {report.qcActionAt && (
            <Text style={[s.qcDate, { color: colors.mutedForeground }]}>
              {new Date(report.qcActionAt).toLocaleString("ko-KR")}
            </Text>
          )}
          {report.qcCorrectiveResult && (
            <>
              <View style={[s.divider, { opacity: 0.5, marginTop: 10 }]} />
              <Row label="시정 결과" value={report.qcCorrectiveResult} colors={colors} />
            </>
          )}
        </View>
      )}

      {/* QC 댓글 */}
      {comments.length > 0 && (
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={s.cardTitle}>QC 코멘트 ({comments.length})</Text>
          <View style={s.divider} />
          {comments.map((c, idx) => (
            <View key={c.id}>
              {idx > 0 && <View style={[s.divider, { opacity: 0.4, marginVertical: 0 }]} />}
              <View style={s.commentRow}>
                <View style={[s.commentAvatar, { backgroundColor: colors.muted }]}>
                  <Text style={[s.commentAvatarText, { color: colors.mutedForeground }]}>
                    {(c.authorName ?? "?").charAt(0)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.commentHeader}>
                    <Text style={[s.commentAuthor, { color: colors.foreground }]}>
                      {c.authorName ?? "알 수 없음"}
                    </Text>
                    <Text style={[s.commentDate, { color: colors.mutedForeground }]}>
                      {new Date(c.createdAt).toLocaleString("ko-KR", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                  <Text style={[s.commentBody, { color: colors.foreground }]}>{c.body}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* SLA 잠금 배너 */}
      {report.isLocked && (
        <View style={[s.lockedBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Ionicons name="lock-closed" size={16} color={colors.mutedForeground} />
          <Text style={[s.lockedText, { color: colors.mutedForeground }]}>
            SLA 초과로 수정이 잠겼습니다.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function makeStyles(
  colors: ReturnType<typeof useColors>,
  topPad: number,
  bottomPad: number
) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    content: {
      paddingTop: topPad + 8,
      paddingHorizontal: 20,
      paddingBottom: bottomPad + 40,
      gap: 12,
    },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 4,
      gap: 8,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      fontSize: 18,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    headerSub: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      marginTop: 1,
    },
    statusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 99,
      borderWidth: 1,
    },
    statusText: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
    },
    card: {
      borderRadius: colors.radius,
      borderWidth: 1,
      padding: 14,
    },
    cardTitle: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 10,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginBottom: 0,
    },
    descText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      lineHeight: 22,
      marginTop: 10,
    },
    qcDate: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      marginTop: 8,
    },
    image: {
      width: "100%",
      height: 200,
      borderRadius: colors.radius - 4,
      marginTop: 10,
    },
    lockedBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 12,
      borderRadius: colors.radius,
      borderWidth: 1,
    },
    lockedText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    errorText: {
      fontSize: 16,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
    backBtn: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.primary,
    },
    backBtnText: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
    commentRow: {
      flexDirection: "row",
      gap: 10,
      paddingVertical: 10,
    },
    commentAvatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
    },
    commentAvatarText: {
      fontSize: 12,
      fontFamily: "Inter_700Bold",
    },
    commentHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 3,
    },
    commentAuthor: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
    },
    commentDate: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
    },
    commentBody: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      lineHeight: 20,
    },
  });
}
