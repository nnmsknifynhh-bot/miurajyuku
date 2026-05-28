import 'package:flutter_test/flutter_test.dart';
import 'package:study_master/main.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const StudyMasterApp());
    expect(find.byType(StudyMasterApp), findsOneWidget);
  });
}
