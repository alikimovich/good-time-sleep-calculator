// LKM-652: a measurement probe injected into either Good Time app on the iOS Simulator
// (SIMCTL_CHILD_DYLD_INSERT_LIBRARIES / XCUIApplication.launchEnvironment). Neither app's source changes,
// and both are measured by the same code:
//
//   launch   process start (the kernel's p_starttime) → the first vsync after the first Core Animation commit
//            whose key window holds the app's content (≥ GTPERF_MIN_LAYERS layers, default 8). This is the
//            definition Exact's own EXACT_SMOKE uses for its `present` mark (ExactKit/Launch.swift), so the
//            Exact app's two numbers cross-check the probe.
//   frames   every main-thread CADisplayLink callback's timestamp; a frame interval longer than 1.5 × the
//            display's period is a missed refresh. Intervals inside the 1.2 s after each touch ends are
//            "motion" (the app's transitions after a tap); the rest are idle.
//   memory   phys_footprint (what Xcode's memory gauge and jetsam use) 1 s after the first frame, and its
//            peak (ledger) at the end.
//
// Output: one JSON object per line on stderr (prefixed "gtperf ") and appended to
// <app data container>/tmp/gtperf.jsonl. GTPERF_EXIT=1 exits 1 s after the first frame (the launch runs);
// otherwise the probe writes its frame summary when the app enters the background.
#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#import <mach/mach.h>
#import <objc/runtime.h>
#import <sys/sysctl.h>

static CFTimeInterval gProcessStart;  // CACurrentMediaTime() timebase
static CFTimeInterval gCommit, gPresent;
static NSUInteger gCommitLayers;
static CADisplayLink *gLink;
static NSMutableArray<NSNumber *> *gStamps;      // display-link timestamps
static NSMutableArray<NSNumber *> *gTouchEnds;   // CACurrentMediaTime() of each touch's end
static NSMutableArray<NSNumber *> *gDurations;   // link.duration per callback
static uint64_t gFootprintSettled;
static BOOL gExit;
static NSUInteger gMinLayers = 8;

static uint64_t footprint(uint64_t *peak) {
  task_vm_info_data_t info;
  mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
  if (task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&info, &count) != KERN_SUCCESS) return 0;
  if (peak) *peak = info.ledger_phys_footprint_peak;
  return info.phys_footprint;
}

static void emit(NSDictionary *object) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingSortedKeys error:nil];
  NSString *line = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  fprintf(stderr, "gtperf %s\n", line.UTF8String);
  NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:@"gtperf.jsonl"];
  NSFileHandle *h = [NSFileHandle fileHandleForWritingAtPath:path];
  if (!h) { [[NSFileManager defaultManager] createFileAtPath:path contents:nil attributes:nil]; h = [NSFileHandle fileHandleForWritingAtPath:path]; }
  [h seekToEndOfFile];
  [h writeData:[[line stringByAppendingString:@"\n"] dataUsingEncoding:NSUTF8StringEncoding]];
  [h closeFile];
}

static NSUInteger layerCount(CALayer *layer, NSUInteger limit) {
  NSUInteger n = 1;
  for (CALayer *sub in layer.sublayers) {
    if (n >= limit) break;
    n += layerCount(sub, limit - n);
  }
  return n;
}

static UIWindow *keyWindow(void) {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class]) continue;
    for (UIWindow *w in ((UIWindowScene *)scene).windows) if (w.isKeyWindow && !w.hidden) return w;
  }
  return nil;
}

static double ms(CFTimeInterval s) { return round(s * 10000.0) / 10.0; }

static double quantile(NSArray<NSNumber *> *sorted, double q) {
  if (sorted.count == 0) return 0;
  NSUInteger i = MIN(sorted.count - 1, (NSUInteger)ceil(q * sorted.count) - (q > 0 ? 1 : 0));
  return sorted[i].doubleValue;
}

static NSDictionary *summary(NSArray<NSNumber *> *intervals, NSArray<NSNumber *> *periods) {
  if (intervals.count == 0) return @{@"intervals": @0};
  NSArray *sorted = [intervals sortedArrayUsingSelector:@selector(compare:)];
  NSUInteger missed = 0, longFrames = 0;
  double total = 0;
  for (NSUInteger i = 0; i < intervals.count; i++) {
    double v = intervals[i].doubleValue, p = periods[i].doubleValue;
    total += v;
    if (p > 0 && v > 1.5 * p) { longFrames++; missed += (NSUInteger)llround(v / p) - 1; }
  }
  return @{
    @"intervals": @(intervals.count),
    @"seconds": @(round(total * 100) / 100),
    @"fps": @(round(intervals.count / total * 10) / 10),
    @"medianMs": @(ms(quantile(sorted, 0.5))),
    @"p95Ms": @(ms(quantile(sorted, 0.95))),
    @"p99Ms": @(ms(quantile(sorted, 0.99))),
    @"maxMs": @(ms([sorted.lastObject doubleValue])),
    @"longFrames": @(longFrames),
    @"missedRefreshes": @(missed),
  };
}

static void writeFrames(NSString *why) {
  NSMutableArray *motion = [NSMutableArray array], *motionP = [NSMutableArray array];
  NSMutableArray *idle = [NSMutableArray array], *idleP = [NSMutableArray array];
  for (NSUInteger i = 1; i < gStamps.count; i++) {
    double t0 = gStamps[i - 1].doubleValue, t1 = gStamps[i].doubleValue, v = t1 - t0;
    if (t0 < gPresent + 1.0) continue;  // the launch itself is measured separately
    BOOL inMotion = NO;
    for (NSNumber *end in gTouchEnds) if (t1 > end.doubleValue && t0 < end.doubleValue + 1.2) { inMotion = YES; break; }
    [(inMotion ? motion : idle) addObject:@(v)];
    [(inMotion ? motionP : idleP) addObject:gDurations[i]];
  }
  uint64_t peak = 0, now = footprint(&peak);
  emit(@{@"kind": @"frames", @"why": why, @"touches": @(gTouchEnds.count),
         @"periodMs": @(ms(gLink.duration)), @"maxFps": @(UIScreen.mainScreen.maximumFramesPerSecond),
         @"motion": summary(motion, motionP), @"idle": summary(idle, idleP),
         @"footprintMB": @(round(now / 1048576.0 * 10) / 10), @"peakFootprintMB": @(round(peak / 1048576.0 * 10) / 10)});
}

@interface GTPerfProbe : NSObject
@end

@implementation GTPerfProbe
+ (void)tick:(CADisplayLink *)link {
  [gStamps addObject:@(link.timestamp)];
  [gDurations addObject:@(link.duration)];
  if (gCommit > 0 && gPresent == 0 && link.duration > 0) {
    // The first vsync at or after the commit, on this callback's grid (Exact's Vsync.next(after:)).
    double k = ceil((gCommit - link.timestamp) / link.duration);
    gPresent = link.timestamp + MAX(0, k) * link.duration;
    emit(@{@"kind": @"launch", @"processToPresentMs": @(ms(gPresent - gProcessStart)),
           @"processToCommitMs": @(ms(gCommit - gProcessStart)), @"layers": @(gCommitLayers)});
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      gFootprintSettled = footprint(NULL);
      UIWindow *w = keyWindow();
      emit(@{@"kind": @"memory", @"settledFootprintMB": @(round(gFootprintSettled / 1048576.0 * 10) / 10),
             @"settledLayers": @(w ? layerCount(w.layer, 10000) : 0)});
      if (gExit) exit(0);
    });
  }
}
@end

// UIApplication.sendEvent: — every touch reaches the app through it, whichever UI framework draws.
static IMP gSendEvent;
static void probeSendEvent(id self, SEL _cmd, UIEvent *event) {
  ((void (*)(id, SEL, UIEvent *))gSendEvent)(self, _cmd, event);
  if (event.type != UIEventTypeTouches) return;
  for (UITouch *t in event.allTouches)
    if (t.phase == UITouchPhaseEnded || t.phase == UITouchPhaseCancelled) { [gTouchEnds addObject:@(CACurrentMediaTime())]; break; }
}

__attribute__((constructor)) static void GTPerfProbeStart(void) {
  NSDictionary *env = NSProcessInfo.processInfo.environment;
  gExit = [env[@"GTPERF_EXIT"] isEqualToString:@"1"];
  if (env[@"GTPERF_MIN_LAYERS"]) gMinLayers = (NSUInteger)[env[@"GTPERF_MIN_LAYERS"] integerValue];
  gStamps = [NSMutableArray arrayWithCapacity:8192];
  gDurations = [NSMutableArray arrayWithCapacity:8192];
  gTouchEnds = [NSMutableArray array];

  // Process start on the CACurrentMediaTime() timebase: now minus the process's age.
  struct kinfo_proc info;
  size_t size = sizeof(info);
  int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()};
  struct timeval wall;
  gettimeofday(&wall, NULL);
  CFTimeInterval mono = CACurrentMediaTime();
  if (sysctl(mib, 4, &info, &size, NULL, 0) == 0) {
    double started = info.kp_proc.p_starttime.tv_sec + info.kp_proc.p_starttime.tv_usec / 1e6;
    double now = wall.tv_sec + wall.tv_usec / 1e6;
    gProcessStart = mono - (now - started);
  }

  Method m = class_getInstanceMethod(objc_getClass("UIApplication"), @selector(sendEvent:));
  gSendEvent = method_setImplementation(m, (IMP)probeSendEvent);

  // After Core Animation's commit observer (order 2000000) in each run-loop turn: the first turn whose
  // key window holds the content is the first frame's commit.
  CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(NULL, kCFRunLoopBeforeWaiting, true, 2000001,
    ^(CFRunLoopObserverRef o, CFRunLoopActivity a) {
      if (!gLink && UIApplication.sharedApplication) {
        gLink = [CADisplayLink displayLinkWithTarget:GTPerfProbe.class selector:@selector(tick:)];
        if (@available(iOS 15.0, *)) {
          float max = (float)UIScreen.mainScreen.maximumFramesPerSecond;
          gLink.preferredFrameRateRange = CAFrameRateRangeMake(max, max, max);
        }
        [gLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
        [NSNotificationCenter.defaultCenter addObserverForName:UIApplicationDidEnterBackgroundNotification object:nil
          queue:nil usingBlock:^(NSNotification *n) { writeFrames(@"background"); }];
      }
      if (gCommit > 0) return;
      UIWindow *w = keyWindow();
      if (!w) return;
      NSUInteger layers = layerCount(w.layer, 10000);
      if (layers < gMinLayers) return;
      gCommit = CACurrentMediaTime();
      gCommitLayers = layers;
    });
  CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
}
