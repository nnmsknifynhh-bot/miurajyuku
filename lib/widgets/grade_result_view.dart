// ============================================================
// 採点結果の表示部品（生徒・先生 共通）
// ============================================================
import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../services/grading_service.dart';
import '../theme/app_theme.dart';

/// 点数の大きな表示
class ScoreHeader extends StatelessWidget {
  final int score;
  final int total;
  const ScoreHeader({super.key, required this.score, required this.total});

  @override
  Widget build(BuildContext context) {
    final rate = total == 0 ? 0.0 : score / total;
    final color = rate >= 0.8
        ? AppColors.success
        : rate >= 0.5
            ? AppColors.warning
            : AppColors.danger;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(children: [
        Icon(Icons.task_alt, color: color, size: 28),
        const SizedBox(width: 10),
        Text('$score', style: TextStyle(color: color, fontSize: 32, fontWeight: FontWeight.w900)),
        Text(' / $total 問 正解',
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 14, fontWeight: FontWeight.w600)),
        const Spacer(),
        Text('${(rate * 100).round()}%',
            style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w800)),
      ]),
    );
  }
}

/// 1問ごとの ○× 行。[onToggle] を渡すと先生が ○× を切り替えられる
class GradeItemTile extends StatelessWidget {
  final GradeItem item;
  final VoidCallback? onToggle;
  final String answerLabel;
  const GradeItemTile({super.key, required this.item, this.onToggle, this.answerLabel = 'あなたの答え'});

  @override
  Widget build(BuildContext context) {
    final color = item.correct ? AppColors.success : AppColors.danger;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        GestureDetector(
          onTap: onToggle,
          child: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: color.withValues(alpha: 0.15),
              border: Border.all(color: color, width: 2),
            ),
            alignment: Alignment.center,
            child: Icon(item.correct ? Icons.circle_outlined : Icons.close_rounded, color: color, size: 24),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(item.number,
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            _line(answerLabel, item.studentAnswer, AppColors.silver),
            if (!item.correct) _line('正解', item.correctAnswer, AppColors.success),
            if (!item.correct && item.comment.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(item.comment,
                    style: const TextStyle(color: AppColors.warning, fontSize: 12, height: 1.4)),
              ),
          ]),
        ),
        if (onToggle != null)
          IconButton(
            tooltip: '○×を切り替え',
            icon: const Icon(Icons.swap_horiz, color: AppColors.silverDim, size: 20),
            onPressed: onToggle,
          ),
      ]),
    );
  }

  Widget _line(String label, String value, Color color) => Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Text.rich(TextSpan(children: [
          TextSpan(text: '$label：', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          TextSpan(text: value, style: TextStyle(color: color, fontSize: 13)),
        ])),
      );
}

/// コメント枠
class CommentBox extends StatelessWidget {
  final String title;
  final String text;
  final IconData icon;
  final Color color;
  const CommentBox(
      {super.key, required this.title, required this.text, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 6),
          Text(title, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
        ]),
        const SizedBox(height: 6),
        Text(text, style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, height: 1.5)),
      ]),
    );
  }
}

/// 答案写真の横並びサムネイル（タップで拡大）
class PhotoStrip extends StatelessWidget {
  final List<Uint8List>? photos; // null = 読み込み中
  final String? error;
  const PhotoStrip({super.key, required this.photos, this.error});

  @override
  Widget build(BuildContext context) {
    if (error != null) {
      return Text('写真を読み込めませんでした: $error',
          style: const TextStyle(color: AppColors.danger, fontSize: 12));
    }
    if (photos == null) {
      return const SizedBox(
        height: 120,
        child: Center(child: CircularProgressIndicator(color: AppColors.yellow, strokeWidth: 2)),
      );
    }
    return SizedBox(
      height: 120,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: photos!.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (ctx, i) => GestureDetector(
          onTap: () => showPhotoViewer(ctx, photos!, i),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Image.memory(photos![i], height: 120, fit: BoxFit.cover),
          ),
        ),
      ),
    );
  }
}

void showPhotoViewer(BuildContext context, List<Uint8List> photos, int initial) {
  showDialog(
    context: context,
    barrierColor: Colors.black,
    builder: (ctx) => Stack(children: [
      PageView.builder(
        controller: PageController(initialPage: initial),
        itemCount: photos.length,
        itemBuilder: (_, i) => InteractiveViewer(
          maxScale: 5,
          child: Center(child: Image.memory(photos[i])),
        ),
      ),
      Positioned(
        top: 16,
        right: 16,
        child: SafeArea(
          child: IconButton(
            style: IconButton.styleFrom(backgroundColor: Colors.black54),
            icon: const Icon(Icons.close, color: Colors.white),
            onPressed: () => Navigator.pop(ctx),
          ),
        ),
      ),
    ]),
  );
}

/// 状態ラベルの色
Color statusColor(String status) {
  switch (status) {
    case HomeworkSubmission.statusReturned:
      return AppColors.success;
    case HomeworkSubmission.statusGraded:
      return AppColors.yellow;
    case HomeworkSubmission.statusError:
      return AppColors.danger;
    default:
      return AppColors.info;
  }
}

// ============================================================
// 答案写真に赤ペンで ○ / ✓ を書き込んで表示する
//   ○ = 正解、✓ = 不正解（日本の採点の書き方）
//   位置は AI が返した box（答えの範囲, 0〜1000）を使う
// ============================================================
const Color redPen = Color(0xFFE53935);

/// 1枚の答案写真 + 赤ペンの採点マーク
class MarkedPhoto extends StatefulWidget {
  final Uint8List bytes;

  /// この写真の番号（1始まり）。items のうち photo が一致するものを描く
  final int photoNumber;
  final List<GradeItem> items;

  /// 右上に書く点数（例: "8/10"）。null なら書かない
  final String? scoreLabel;

  /// マークをタップしたとき（先生が ○/✓ を切り替える）。null なら切り替え不可
  final void Function(GradeItem item)? onToggleItem;

  /// マーク以外をタップしたとき（拡大表示など）
  final VoidCallback? onTapPhoto;

  const MarkedPhoto({
    super.key,
    required this.bytes,
    required this.photoNumber,
    required this.items,
    this.scoreLabel,
    this.onToggleItem,
    this.onTapPhoto,
  });

  @override
  State<MarkedPhoto> createState() => _MarkedPhotoState();
}

class _MarkedPhotoState extends State<MarkedPhoto> {
  double? _aspect; // 幅 / 高さ

  @override
  void initState() {
    super.initState();
    _measure();
  }

  @override
  void didUpdateWidget(MarkedPhoto old) {
    super.didUpdateWidget(old);
    if (!identical(old.bytes, widget.bytes)) _measure();
  }

  Future<void> _measure() async {
    try {
      final img = await decodeImageFromList(widget.bytes);
      final a = img.width / img.height;
      img.dispose();
      if (mounted) setState(() => _aspect = a);
    } catch (_) {
      if (mounted) setState(() => _aspect = 3 / 4);
    }
  }

  List<GradeItem> get _mine =>
      widget.items.where((it) => it.photo == widget.photoNumber && it.box != null).toList();

  @override
  Widget build(BuildContext context) {
    if (_aspect == null) {
      return const AspectRatio(
        aspectRatio: 3 / 4,
        child: Center(child: CircularProgressIndicator(color: AppColors.yellow, strokeWidth: 2)),
      );
    }
    return AspectRatio(
      aspectRatio: _aspect!,
      child: LayoutBuilder(builder: (context, c) {
        final size = c.biggest;
        final marks = _mine;
        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapUp: (d) {
            if (widget.onToggleItem != null) {
              final hit = _hitTest(marks, size, d.localPosition);
              if (hit != null) return widget.onToggleItem!(hit);
            }
            widget.onTapPhoto?.call();
          },
          child: Stack(fit: StackFit.expand, children: [
            Image.memory(widget.bytes, fit: BoxFit.fill, gaplessPlayback: true),
            CustomPaint(painter: _RedPenPainter(marks, widget.scoreLabel)),
          ]),
        );
      }),
    );
  }

  GradeItem? _hitTest(List<GradeItem> marks, Size size, Offset p) {
    GradeItem? best;
    double bestD = double.infinity;
    for (final it in marks) {
      final m = _MarkGeometry.of(it, size);
      final d = (m.center - p).distance;
      final reach = m.oval.longestSide / 2 + 16;
      if (d < reach && d < bestD) {
        best = it;
        bestD = d;
      }
    }
    return best;
  }
}

/// マークの位置と大きさ（描画とタップ判定で共通）
class _MarkGeometry {
  final Offset center;
  final Rect oval; // ○ の外形 / ✓ の大きさの基準
  final double stroke;
  _MarkGeometry(this.center, this.oval, this.stroke);

  factory _MarkGeometry.of(GradeItem it, Size size) {
    final b = it.box!;
    final r = Rect.fromLTRB(
      b[1] / 1000 * size.width,
      b[0] / 1000 * size.height,
      b[3] / 1000 * size.width,
      b[2] / 1000 * size.height,
    );
    final short = size.shortestSide;
    final h = (r.height * 2.0).clamp(short * 0.07, short * 0.24);
    final w = (r.width * 1.15 + h * 0.3).clamp(h, size.width * 0.9);
    final oval = Rect.fromCenter(center: r.center, width: w, height: h);
    final stroke = (h * 0.08).clamp(1.5, 10.0);
    return _MarkGeometry(r.center, oval, stroke);
  }
}

class _RedPenPainter extends CustomPainter {
  final List<GradeItem> items;
  final String? scoreLabel;
  _RedPenPainter(this.items, this.scoreLabel);

  @override
  void paint(Canvas canvas, Size size) {
    for (final it in items) {
      final g = _MarkGeometry.of(it, size);
      final pen = Paint()
        ..color = redPen.withValues(alpha: 0.9)
        ..style = PaintingStyle.stroke
        ..strokeWidth = it.correct ? g.stroke : g.stroke * 1.3
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round;
      if (it.correct) {
        canvas.drawOval(g.oval, pen);
      } else {
        // ✓（チェック）を答えの上に書く
        final s = g.oval.height;
        final c = g.center;
        final path = Path()
          ..moveTo(c.dx - s * 0.45, c.dy - s * 0.05)
          ..lineTo(c.dx - s * 0.12, c.dy + s * 0.38)
          ..lineTo(c.dx + s * 0.55, c.dy - s * 0.55);
        canvas.drawPath(path, pen);
      }
    }

    if (scoreLabel != null) {
      final fontSize = size.width * 0.085;
      final tp = TextPainter(
        text: TextSpan(
          text: scoreLabel,
          style: TextStyle(color: redPen, fontSize: fontSize, fontWeight: FontWeight.w900, height: 1),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      final pad = fontSize * 0.35;
      final topRight = Offset(size.width - tp.width - pad * 2.2, pad * 1.2);
      final bg = Rect.fromLTWH(topRight.dx - pad, topRight.dy - pad * 0.6, tp.width + pad * 2, tp.height + pad * 1.4);
      canvas.drawRRect(RRect.fromRectAndRadius(bg, Radius.circular(pad)),
          Paint()..color = Colors.white.withValues(alpha: 0.85));
      tp.paint(canvas, topRight);
      // 点数の下に二重線（先生の書き方）
      final line = Paint()
        ..color = redPen
        ..strokeWidth = (fontSize * 0.06).clamp(1.0, 4.0);
      final y1 = topRight.dy + tp.height + pad * 0.2;
      canvas.drawLine(Offset(topRight.dx, y1), Offset(topRight.dx + tp.width, y1), line);
      canvas.drawLine(Offset(topRight.dx, y1 + line.strokeWidth * 2),
          Offset(topRight.dx + tp.width, y1 + line.strokeWidth * 2), line);
    }
  }

  @override
  bool shouldRepaint(_RedPenPainter old) => true;
}

/// 採点マーク付きの答案写真を縦に並べる（1枚目の右上に点数）
class MarkedPhotoList extends StatelessWidget {
  final List<Uint8List>? photos; // null = 読み込み中
  final String? error;
  final List<GradeItem> items;
  final void Function(GradeItem item)? onToggleItem;

  const MarkedPhotoList({
    super.key,
    required this.photos,
    required this.items,
    this.error,
    this.onToggleItem,
  });

  String get _score => '${items.where((e) => e.correct).length}/${items.length}';

  @override
  Widget build(BuildContext context) {
    if (error != null) {
      return Text('写真を読み込めませんでした: $error',
          style: const TextStyle(color: AppColors.danger, fontSize: 12));
    }
    if (photos == null) {
      return const SizedBox(
        height: 240,
        child: Center(child: CircularProgressIndicator(color: AppColors.yellow, strokeWidth: 2)),
      );
    }
    return Column(children: [
      for (var i = 0; i < photos!.length; i++)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: MarkedPhoto(
              bytes: photos![i],
              photoNumber: i + 1,
              items: items,
              scoreLabel: i == 0 && items.isNotEmpty ? _score : null,
              onToggleItem: onToggleItem,
              onTapPhoto: () => showMarkedPhotoViewer(context, photos!, items, i, _score),
            ),
          ),
        ),
    ]);
  }
}

/// 採点マーク付き写真の全画面表示（ピンチで拡大）
void showMarkedPhotoViewer(
    BuildContext context, List<Uint8List> photos, List<GradeItem> items, int initial, String score) {
  showDialog(
    context: context,
    barrierColor: Colors.black,
    builder: (ctx) => Stack(children: [
      PageView.builder(
        controller: PageController(initialPage: initial),
        itemCount: photos.length,
        itemBuilder: (_, i) => InteractiveViewer(
          maxScale: 5,
          child: Center(
            child: MarkedPhoto(
              bytes: photos[i],
              photoNumber: i + 1,
              items: items,
              scoreLabel: i == 0 && items.isNotEmpty ? score : null,
            ),
          ),
        ),
      ),
      Positioned(
        top: 16,
        right: 16,
        child: SafeArea(
          child: IconButton(
            style: IconButton.styleFrom(backgroundColor: Colors.black54),
            icon: const Icon(Icons.close, color: Colors.white),
            onPressed: () => Navigator.pop(ctx),
          ),
        ),
      ),
    ]),
  );
}
