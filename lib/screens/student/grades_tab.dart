import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../theme/app_theme.dart';
import '../../providers/app_provider.dart';
import '../../models/app_models.dart';
import '../../widgets/common_widgets.dart';

class GradesTab extends StatefulWidget {
  const GradesTab({super.key});

  @override
  State<GradesTab> createState() => _GradesTabState();
}

class _GradesTabState extends State<GradesTab> with SingleTickerProviderStateMixin {
  late TabController _tabController;


  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final userId = provider.currentUser?.id ?? '';
    final scores = provider.getScoresForStudent(userId);
    final naishinList = provider.getNaishinForStudent(userId);
    final mockTests = provider.getMockTestsForStudent(userId);

    return Column(
      children: [
        Container(
          color: AppColors.navyDark,
          child: TabBar(
            controller: _tabController,
            tabs: const [
              Tab(text: '定期テスト'),
              Tab(text: '内申'),
              Tab(text: '模試'),
            ],
            labelColor: AppColors.yellow,
            unselectedLabelColor: AppColors.silverDim,
            indicatorColor: AppColors.yellow,
            indicatorWeight: 2,
          ),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              _ExamScoresTab(scores: scores),
              _NaishinTab(naishinList: naishinList, userId: userId),
              _MockTestTab(mockTests: mockTests, userId: userId),
            ],
          ),
        ),
      ],
    );
  }
}

// ---- Exam Scores Tab ----
class _ExamScoresTab extends StatefulWidget {
  final List<ExamScore> scores;
  const _ExamScoresTab({required this.scores});

  @override
  State<_ExamScoresTab> createState() => _ExamScoresTabState();
}

class _ExamScoresTabState extends State<_ExamScoresTab> {
  String? _selectedExamType;
  bool _showGraph = false;

  @override
  void initState() {
    super.initState();
    if (widget.scores.isNotEmpty) _selectedExamType = widget.scores.last.examType;
  }

  @override
  Widget build(BuildContext context) {
    final scores = widget.scores;
    final selected = scores.where((e) => e.examType == _selectedExamType).firstOrNull;

    return SingleChildScrollView(
      child: Column(
        children: [
          // Exam type selector
          SizedBox(
            height: 50,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              itemCount: examTypes.length,
              itemBuilder: (_, i) {
                final type = examTypes[i];
                final has = scores.any((s) => s.examType == type);
                final sel = _selectedExamType == type;
                return GestureDetector(
                  onTap: () => setState(() => _selectedExamType = type),
                  child: Container(
                    margin: const EdgeInsets.only(right: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    decoration: BoxDecoration(
                      color: sel ? AppColors.yellow : has ? AppColors.navyCard : AppColors.navyDark,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: sel ? AppColors.yellow : AppColors.cardBorder),
                    ),
                    child: Text(type, style: TextStyle(
                      color: sel ? AppColors.navyDark : has ? AppColors.textPrimary : AppColors.silverDim,
                      fontWeight: sel ? FontWeight.w700 : FontWeight.w400,
                      fontSize: 12,
                    )),
                  ),
                );
              },
            ),
          ),

          // ── 入力・編集ボタン（データあり/なし両方で常に表示）──
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                if (selected != null)
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => setState(() => _showGraph = !_showGraph),
                      icon: Icon(_showGraph ? Icons.table_chart : Icons.show_chart, size: 16),
                      label: Text(_showGraph ? '表を表示' : 'グラフを表示'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.yellow,
                        side: const BorderSide(color: AppColors.yellow),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                if (selected != null) const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () => _showEditDialog(
                        context,
                        context.read<AppProvider>().currentUser?.id ?? '',
                        selected),
                    icon: Icon(selected != null ? Icons.edit : Icons.add, size: 16),
                    label: Text(selected != null ? '編集' : '入力する'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: selected != null ? AppColors.navyCard : AppColors.yellow,
                      foregroundColor: selected != null ? AppColors.textPrimary : AppColors.navyDark,
                      minimumSize: const Size(0, 42),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      elevation: 0,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          if (selected != null) ...[
            // Summary card
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: GlowCard(
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(selected.examType, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              Text('${selected.totalScore}点', style: const TextStyle(
                                color: AppColors.yellow, fontSize: 40, fontWeight: FontWeight.w900,
                              )),
                              Text('平均 ${selected.average.toStringAsFixed(1)}点 / ${selected.subjectCount}教科',
                                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    // 科目ごとスコアグリッド（教科別前回差分付き）
                    _buildScoreGrid(scores, selected),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),

            if (_showGraph) Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: _TrendGraph(scores: scores),
            ),

            // Reflection card
            if (selected.goodPoints != null || selected.nextGoal != null)
              _buildReflectionCard(selected),

            // Reflection edit button
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: GestureDetector(
                onTap: () => _showReflectionDialog(context, context.read<AppProvider>().currentUser?.id ?? '', selected),
                child: GlowCard(
                  glowColor: AppColors.info,
                  child: Row(
                    children: [
                      const Icon(Icons.psychology, color: AppColors.info),
                      const SizedBox(width: 12),
                      const Text('振り返り・目標入力', style: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600)),
                      const Spacer(),
                      const Icon(Icons.arrow_forward_ios, color: AppColors.silverDim, size: 14),
                    ],
                  ),
                ),
              ),
            ),
          ] else
            const Padding(
              padding: EdgeInsets.all(32),
              child: EmptyState(message: 'このテストのデータを入力してみよう', icon: Icons.edit_note),
            ),
        ],
      ),
    );
  }

  /// 科目ごとスコアグリッド（前回比較差分付き）
  Widget _buildScoreGrid(List<ExamScore> allScores, ExamScore current) {
    // 前回テストを取得（教科種類が変わっても科目単位で比較）
    final order = examTypes;
    final currentIdx = order.indexOf(current.examType);
    ExamScore? prev;
    if (currentIdx > 0) {
      for (int i = currentIdx - 1; i >= 0; i--) {
        final p = allScores.where((e) => e.examType == order[i]).firstOrNull;
        if (p != null) { prev = p; break; }
      }
    }

    return Column(
      children: current.scores.entries.map((e) {
        final subject = e.key;
        final val = e.value;
        final isHigh = val != null && val >= 90;
        final prevVal = prev?.scores[subject];
        final diff = (val != null && prevVal != null) ? val - prevVal : null;

        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            children: [
              SizedBox(width: 72, child: Text(subject, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13))),
              Expanded(
                child: Stack(
                  children: [
                    Container(height: 8, decoration: BoxDecoration(
                      color: AppColors.navyCard, borderRadius: BorderRadius.circular(4),
                    )),
                    if (val != null)
                      FractionallySizedBox(
                        widthFactor: (val / 100).clamp(0.0, 1.0),
                        child: Container(
                          height: 8,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(4),
                            color: isHigh ? AppColors.yellow : AppColors.silver,
                            boxShadow: isHigh ? [BoxShadow(color: AppColors.yellow.withValues(alpha: 0.5), blurRadius: 6)] : null,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              // 点数
              SizedBox(
                width: 40,
                child: Text(val?.toString() ?? '-', style: TextStyle(
                  color: isHigh ? AppColors.yellow : AppColors.textPrimary,
                  fontSize: 15, fontWeight: FontWeight.w800,
                ), textAlign: TextAlign.right),
              ),
              // 前回差分（科目ごと）
              SizedBox(
                width: 36,
                child: diff == null
                    ? const SizedBox.shrink()
                    : Text(
                        diff > 0 ? '+$diff' : '$diff',
                        style: TextStyle(
                          color: diff > 0 ? AppColors.success : diff < 0 ? AppColors.danger : AppColors.textSecondary,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                        textAlign: TextAlign.right,
                      ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildReflectionCard(ExamScore score) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: GlowCard(
        glowColor: AppColors.success,
        margin: const EdgeInsets.only(bottom: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('振り返り', style: TextStyle(color: AppColors.yellow, fontWeight: FontWeight.w700, fontSize: 14)),
            const SizedBox(height: 12),
            if (score.goodPoints != null && score.goodPoints!.isNotEmpty) ...[
              _reflectionRow('✅ 良かった点', score.goodPoints!, AppColors.success),
              const SizedBox(height: 8),
            ],
            if (score.reflections != null && score.reflections!.isNotEmpty) ...[
              _reflectionRow('📝 反省点', score.reflections!, AppColors.warning),
              const SizedBox(height: 8),
            ],
            if (score.nextGoal != null && score.nextGoal!.isNotEmpty) ...[
              _reflectionRow('🎯 次回目標', score.nextGoal!, AppColors.info),
            ],
            if (score.goalDeadline != null && score.goalDetail != null) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.navyCard,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.cardBorder),
                ),
                child: Text('📅 ${score.goalDeadline}までに ${score.goalDetail}',
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w600)),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _reflectionRow(String label, String value, Color color) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
        const SizedBox(width: 8),
        Expanded(child: Text(value, style: const TextStyle(color: AppColors.textPrimary, fontSize: 13))),
      ],
    );
  }

  void _showEditDialog(BuildContext context, String userId, ExamScore? existing) {
    final provider = context.read<AppProvider>();
    // 現在選択中のテスト種別を使う（期末・学年末なら9教科、それ以外は5教科）
    final examType = _selectedExamType ?? examTypes[0];
    final isNineSubjects = examType.contains('期末') || examType == '学年末';
    final subjects = isNineSubjects ? subjects9 : subjects5;

    // existing のスコアから初期値を設定。新規なら空文字
    final controllers = <String, TextEditingController>{
      for (var s in subjects)
        s: TextEditingController(text: existing?.scores[s]?.toString() ?? '')
    };

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => AlertDialog(
          backgroundColor: AppColors.card,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('$examType　成績入力',
                style: const TextStyle(
                    color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 15)),
            Text(isNineSubjects ? '9教科入力' : '5教科入力',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          ]),
          content: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: subjects.map((s) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 80,
                        child: Text(s,
                            style: const TextStyle(
                                color: AppColors.textSecondary, fontSize: 13)),
                      ),
                      Expanded(
                        child: TextField(
                          controller: controllers[s],
                          keyboardType: TextInputType.number,
                          style: const TextStyle(
                              color: AppColors.textPrimary, fontSize: 14),
                          decoration: InputDecoration(
                            hintText: '0〜100',
                            suffixText: '点',
                            isDense: true,
                            filled: true,
                            fillColor: AppColors.navyCard,
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide: BorderSide.none),
                            contentPadding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 10),
                          ),
                        ),
                      ),
                    ],
                  ),
                )).toList(),
              ),
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('キャンセル',
                    style: TextStyle(color: AppColors.silverDim))),
            ElevatedButton(
              onPressed: () {
                final scores = <String, int?>{};
                for (var s in subjects) {
                  final val = int.tryParse(controllers[s]?.text.trim() ?? '');
                  scores[s] = val;
                }
                final newScore = ExamScore(
                  id: existing?.id ?? 'e_${DateTime.now().millisecondsSinceEpoch}',
                  studentId: userId,
                  examType: examType,
                  year: DateTime.now().year,
                  scores: scores,
                  goodPoints: existing?.goodPoints,
                  reflections: existing?.reflections,
                  nextGoal: existing?.nextGoal,
                  goalDeadline: existing?.goalDeadline,
                  goalDetail: existing?.goalDetail,
                );
                provider.saveExamScore(newScore);
                Navigator.pop(ctx);
              },
              style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.yellow,
                  foregroundColor: AppColors.navyDark),
              child: const Text('保存', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      ),
    );
  }

  void _showReflectionDialog(BuildContext context, String userId, ExamScore score) {
    final provider = context.read<AppProvider>();
    final goodCtrl = TextEditingController(text: score.goodPoints ?? '');
    final reflectCtrl = TextEditingController(text: score.reflections ?? '');
    final goalCtrl = TextEditingController(text: score.nextGoal ?? '');
    final deadlineCtrl = TextEditingController(text: score.goalDeadline ?? '');
    final detailCtrl = TextEditingController(text: score.goalDetail ?? '');

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('振り返り入力', style: TextStyle(color: AppColors.yellow, fontWeight: FontWeight.w700)),
        content: SingleChildScrollView(
          child: Column(
            children: [
              _dialogField(goodCtrl, '✅ 良かった点'),
              const SizedBox(height: 12),
              _dialogField(reflectCtrl, '📝 反省点'),
              const SizedBox(height: 12),
              _dialogField(goalCtrl, '🎯 次回目標'),
              const SizedBox(height: 12),
              _dialogField(deadlineCtrl, '📅 期限（例：6月15日）'),
              const SizedBox(height: 12),
              _dialogField(detailCtrl, '📌 具体的な内容（例：ワーク80ページ）'),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim))),
          ElevatedButton(
            onPressed: () {
              final updated = ExamScore(
                id: score.id,
                studentId: userId,
                examType: score.examType,
                year: score.year,
                scores: score.scores,
                goodPoints: goodCtrl.text,
                reflections: reflectCtrl.text,
                nextGoal: goalCtrl.text,
                goalDeadline: deadlineCtrl.text,
                goalDetail: detailCtrl.text,
              );
              provider.saveExamScore(updated);
              Navigator.pop(ctx);
            },
            child: const Text('保存'),
          ),
        ],
      ),
    );
  }

  Widget _dialogField(TextEditingController ctrl, String label) {
    return TextField(
      controller: ctrl,
      maxLines: 2,
      decoration: InputDecoration(labelText: label, isDense: true),
      style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
    );
  }
}

// ---- Trend Graph ----
class _TrendGraph extends StatelessWidget {
  final List<ExamScore> scores;
  const _TrendGraph({required this.scores});

  @override
  Widget build(BuildContext context) {
    final sorted = [...scores]..sort((a, b) => examTypes.indexOf(a.examType).compareTo(examTypes.indexOf(b.examType)));
    if (sorted.length < 2) {
      return const Text('グラフ表示には2回以上のデータが必要です', style: TextStyle(color: AppColors.textSecondary));
    }

    final totalSpots = sorted.asMap().entries.map((e) =>
        FlSpot(e.key.toDouble(), e.value.totalScore.toDouble())).toList();

    return GlowCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('合計点推移', style: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          SizedBox(
            height: 200,
            child: LineChart(
              LineChartData(
                backgroundColor: Colors.transparent,
                gridData: FlGridData(
                  show: true,
                  getDrawingHorizontalLine: (val) => FlLine(color: AppColors.cardBorder, strokeWidth: 1),
                  getDrawingVerticalLine: (val) => FlLine(color: AppColors.cardBorder, strokeWidth: 1),
                ),
                titlesData: FlTitlesData(
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 40,
                      getTitlesWidget: (val, meta) => Text(val.toInt().toString(),
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 10)),
                    ),
                  ),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      getTitlesWidget: (val, meta) {
                        final idx = val.toInt();
                        if (idx >= 0 && idx < sorted.length) {
                          return Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(sorted[idx].examType.replaceAll('学期', ''),
                                style: const TextStyle(color: AppColors.textSecondary, fontSize: 9)),
                          );
                        }
                        return const SizedBox.shrink();
                      },
                    ),
                  ),
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                ),
                borderData: FlBorderData(show: false),
                lineBarsData: [
                  LineChartBarData(
                    spots: totalSpots,
                    isCurved: true,
                    color: AppColors.yellow,
                    barWidth: 3,
                    dotData: FlDotData(
                      getDotPainter: (spot, _, __, ___) => FlDotCirclePainter(
                        radius: 5,
                        color: AppColors.yellow,
                        strokeWidth: 2,
                        strokeColor: AppColors.navyDark,
                      ),
                    ),
                    belowBarData: BarAreaData(
                      show: true,
                      color: AppColors.yellow.withValues(alpha: 0.1),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---- Naishin Tab ----
class _NaishinTab extends StatelessWidget {
  final List<Naishin> naishinList;
  final String userId;

  const _NaishinTab({required this.naishinList, required this.userId});

  @override
  Widget build(BuildContext context) {
    final terms = ['1学期', '2学期', '3学期'];

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: terms.map((term) {
          final n = naishinList.where((n) => n.term == term).firstOrNull;
          return _NaishinCard(term: term, naishin: n, userId: userId);
        }).toList(),
      ),
    );
  }
}

class _NaishinCard extends StatelessWidget {
  final String term;
  final Naishin? naishin;
  final String userId;

  const _NaishinCard({required this.term, this.naishin, required this.userId});

  @override
  Widget build(BuildContext context) {
    return GlowCard(
      margin: const EdgeInsets.only(bottom: 16),
      glowColor: AppColors.info,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(term, style: const TextStyle(color: AppColors.yellow, fontWeight: FontWeight.w700, fontSize: 16)),
              const Spacer(),
              if (naishin != null)
                Text('合計 ${naishin!.total}', style: const TextStyle(
                  color: AppColors.textPrimary, fontSize: 20, fontWeight: FontWeight.w800,
                )),
              const SizedBox(width: 8),
              IconButton(
                icon: const Icon(Icons.edit, color: AppColors.silver, size: 18),
                onPressed: () => _showEditDialog(context),
              ),
            ],
          ),
          if (naishin != null) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: naishin!.grades.entries.map((e) {
                final grade = e.value;
                final isHigh = grade != null && grade >= 5;
                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: isHigh ? AppColors.yellow.withValues(alpha: 0.1) : AppColors.navyCard,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: isHigh ? AppColors.yellow.withValues(alpha: 0.5) : AppColors.cardBorder),
                  ),
                  child: Column(
                    children: [
                      Text(e.key, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                      const SizedBox(height: 2),
                      Text(grade?.toString() ?? '-', style: TextStyle(
                        color: isHigh ? AppColors.yellow : AppColors.textPrimary,
                        fontSize: 20, fontWeight: FontWeight.w800,
                      )),
                    ],
                  ),
                );
              }).toList(),
            ),
          ] else
            const Text('タップして内申を入力', style: TextStyle(color: AppColors.textSecondary)),
        ],
      ),
    );
  }

  void _showEditDialog(BuildContext context) {
    final provider = context.read<AppProvider>();
    final controllers = <String, TextEditingController>{
      for (var s in subjects9)
        s: TextEditingController(text: naishin?.grades[s]?.toString() ?? '')
    };

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('$term 内申入力', style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700)),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: subjects9.map((s) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  SizedBox(width: 70, child: Text(s, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13))),
                  Expanded(
                    child: TextField(
                      controller: controllers[s],
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(hintText: '1〜5', isDense: true,
                          contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
                      style: const TextStyle(color: AppColors.textPrimary),
                    ),
                  ),
                ],
              ),
            )).toList(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('キャンセル', style: TextStyle(color: AppColors.silverDim))),
          ElevatedButton(
            onPressed: () {
              final grades = <String, int?>{};
              for (var s in subjects9) {
                grades[s] = int.tryParse(controllers[s]?.text ?? '');
              }
              final n = Naishin(
                id: naishin?.id ?? 'n_${DateTime.now().millisecondsSinceEpoch}',
                studentId: userId,
                term: term,
                year: DateTime.now().year,
                grades: grades,
              );
              provider.saveNaishin(n);
              Navigator.pop(ctx);
            },
            child: const Text('保存'),
          ),
        ],
      ),
    );
  }
}

// ---- Mock Test Tab ----
class _MockTestTab extends StatelessWidget {
  final List<MockTest> mockTests;
  final String userId;

  const _MockTestTab({required this.mockTests, required this.userId});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: ElevatedButton.icon(
              onPressed: () => _showMockDialog(context, null),
              icon: const Icon(Icons.add),
              label: const Text('模試を追加'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.yellow,
                foregroundColor: AppColors.navyDark,
                minimumSize: const Size(double.infinity, 44),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
          if (mockTests.isEmpty)
            const EmptyState(message: '模試データがありません', icon: Icons.school_outlined)
          else
            ...mockTests.reversed.map((test) => _MockTestCard(
                  test: test,
                  userId: userId,
                  onEdit: () => _showMockDialog(context, test),
                )),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  /// 追加・編集共通ダイアログ（test==nullで追加モード）
  void _showMockDialog(BuildContext context, MockTest? test) {
    final provider = context.read<AppProvider>();
    final isEdit = test != null;
    String selectedName = isEdit ? test.testName : provider.mockTestNames.first;

    final controllers = <String, TextEditingController>{
      for (var s in subjects5)
        s: TextEditingController(text: isEdit ? (test.scores[s]?.toString() ?? '') : '')
    };
    final deviationControllers = <String, TextEditingController>{
      for (var s in subjects5)
        s: TextEditingController(text: isEdit ? (test.deviations[s]?.toStringAsFixed(1) ?? '') : '')
    };
    final schoolCtrl = TextEditingController(text: isEdit ? (test.targetSchool ?? '') : '');

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => AlertDialog(
          backgroundColor: AppColors.card,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Text(
            isEdit ? '模試結果を編集' : '模試結果入力',
            style: TextStyle(
              color: isEdit ? AppColors.info : AppColors.yellow,
              fontWeight: FontWeight.w700,
            ),
          ),
          content: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // 模試名（新規時のみ選択可）
                  isEdit
                      ? Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Row(children: [
                            const Icon(Icons.assignment, color: AppColors.info, size: 16),
                            const SizedBox(width: 8),
                            Text(selectedName,
                                style: const TextStyle(
                                    color: AppColors.textPrimary,
                                    fontWeight: FontWeight.w700,
                                    fontSize: 14)),
                          ]),
                        )
                      : Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                            decoration: BoxDecoration(
                              color: AppColors.navyCard,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: DropdownButton<String>(
                              value: selectedName,
                              dropdownColor: AppColors.card,
                              style: const TextStyle(color: AppColors.textPrimary),
                              underline: const SizedBox.shrink(),
                              isExpanded: true,
                              items: provider.mockTestNames
                                  .map((n) => DropdownMenuItem(value: n, child: Text(n)))
                                  .toList(),
                              onChanged: (v) => setS(() => selectedName = v!),
                            ),
                          ),
                        ),
                  // 志望校
                  TextField(
                    controller: schoolCtrl,
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
                    decoration: InputDecoration(
                      labelText: '志望校',
                      hintText: '例：都立○○高校',
                      labelStyle: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                      hintStyle: const TextStyle(color: AppColors.silverDim, fontSize: 12),
                      filled: true,
                      fillColor: AppColors.navyCard,
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: BorderSide.none),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    ),
                  ),
                  const SizedBox(height: 14),
                  // ヘッダ行
                  Row(children: const [
                    SizedBox(width: 52),
                    Expanded(child: Text('点数', style: TextStyle(color: AppColors.textSecondary, fontSize: 11), textAlign: TextAlign.center)),
                    SizedBox(width: 8),
                    Expanded(child: Text('偏差値', style: TextStyle(color: AppColors.textSecondary, fontSize: 11), textAlign: TextAlign.center)),
                  ]),
                  const SizedBox(height: 4),
                  // 科目行
                  ...subjects5.map((s) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 52,
                          child: Text(s,
                              style: const TextStyle(
                                  color: AppColors.textSecondary, fontSize: 13)),
                        ),
                        Expanded(
                          child: TextField(
                            controller: controllers[s],
                            keyboardType: TextInputType.number,
                            style: const TextStyle(
                                color: AppColors.textPrimary, fontSize: 13),
                            decoration: InputDecoration(
                              hintText: '点',
                              isDense: true,
                              filled: true,
                              fillColor: AppColors.navyCard,
                              border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(8),
                                  borderSide: BorderSide.none),
                              contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 8),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextField(
                            controller: deviationControllers[s],
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            style: const TextStyle(
                                color: AppColors.textPrimary, fontSize: 13),
                            decoration: InputDecoration(
                              hintText: '偏差値',
                              isDense: true,
                              filled: true,
                              fillColor: AppColors.navyCard,
                              border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(8),
                                  borderSide: BorderSide.none),
                              contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 8),
                            ),
                          ),
                        ),
                      ],
                    ),
                  )),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('キャンセル',
                    style: TextStyle(color: AppColors.silverDim))),
            ElevatedButton(
              onPressed: () {
                final scores = <String, int?>{
                  for (var s in subjects5)
                    s: int.tryParse(controllers[s]?.text.trim() ?? '')
                };
                final devs = <String, double?>{
                  for (var s in subjects5)
                    s: double.tryParse(deviationControllers[s]?.text.trim() ?? '')
                };
                final built = MockTest(
                  id: isEdit ? test.id : 'm_${DateTime.now().millisecondsSinceEpoch}',
                  studentId: userId,
                  testName: selectedName,
                  date: isEdit ? test.date : DateTime.now(),
                  scores: scores,
                  deviations: devs,
                  targetSchool: schoolCtrl.text.trim().isNotEmpty
                      ? schoolCtrl.text.trim()
                      : null,
                );
                if (isEdit) {
                  provider.updateMockTest(built);
                } else {
                  provider.saveMockTest(built);
                }
                Navigator.pop(ctx);
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: isEdit ? AppColors.info : AppColors.yellow,
                foregroundColor: isEdit ? Colors.white : AppColors.navyDark,
              ),
              child: Text(isEdit ? '保存' : '追加',
                  style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      ),
    );
  }
}

class _MockTestCard extends StatelessWidget {
  final MockTest test;
  final String userId;
  final VoidCallback onEdit;
  const _MockTestCard({
    required this.test,
    required this.userId,
    required this.onEdit,
  });

  @override
  Widget build(BuildContext context) {
    final provider = context.read<AppProvider>();
    return GlowCard(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      glowColor: AppColors.info,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AppChip(label: test.testName, color: AppColors.info),
              const SizedBox(width: 8),
              Text('${test.date.year}/${test.date.month}/${test.date.day}',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              const Spacer(),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('${test.totalScore}点',
                      style: const TextStyle(
                          color: AppColors.yellow,
                          fontSize: 22,
                          fontWeight: FontWeight.w800)),
                  Text('偏差値 ${test.avgDeviation.toStringAsFixed(1)}',
                      style: const TextStyle(
                          color: AppColors.silver, fontSize: 12)),
                ],
              ),
              // 編集ボタン
              const SizedBox(width: 8),
              Column(
                children: [
                  IconButton(
                    icon: const Icon(Icons.edit_note,
                        color: AppColors.info, size: 20),
                    onPressed: onEdit,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                    tooltip: '編集',
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline,
                        color: AppColors.danger, size: 18),
                    onPressed: () => _confirmDelete(context, provider),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                    tooltip: '削除',
                  ),
                ],
              ),
            ],
          ),
          if (test.targetSchool != null) ...[
            const SizedBox(height: 6),
            Text('🎯 志望校: ${test.targetSchool}',
                style: const TextStyle(color: AppColors.info, fontSize: 13)),
          ],
          const SizedBox(height: 10),
          // 科目ごと点数・偏差値
          ...subjects5.map((s) {
            final score = test.scores[s];
            final dev = test.deviations[s];
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(children: [
                SizedBox(
                    width: 56,
                    child: Text(s,
                        style: const TextStyle(
                            color: AppColors.textSecondary, fontSize: 12))),
                Text(score?.toString() ?? '-',
                    style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w700,
                        fontSize: 13)),
                const Text('点',
                    style: TextStyle(
                        color: AppColors.textSecondary, fontSize: 11)),
                if (dev != null) ...[
                  const SizedBox(width: 10),
                  Text('偏差値 ${dev.toStringAsFixed(1)}',
                      style: const TextStyle(
                          color: AppColors.silver, fontSize: 11)),
                ],
              ]),
            );
          }),
        ],
      ),
    );
  }

  void _confirmDelete(BuildContext context, AppProvider provider) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('模試を削除',
            style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.w700)),
        content: Text('${test.testName}（${test.date.year}/${test.date.month}/${test.date.day}）を削除しますか？',
            style: const TextStyle(color: AppColors.textPrimary, fontSize: 13)),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('キャンセル',
                  style: TextStyle(color: AppColors.silverDim))),
          ElevatedButton(
            onPressed: () {
              provider.removeMockTest(test.id);
              Navigator.pop(ctx);
            },
            style:
                ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
            child: const Text('削除'),
          ),
        ],
      ),
    );
  }
}
