package id.universe.mobile.data

import id.universe.mobile.api.models.GetV1Attendance200ResponseRowsInner
import id.universe.mobile.api.models.GetV1EmployeesByNik200Response
import id.universe.mobile.api.models.GetV1FitToWork200ResponseRowsInner
import id.universe.mobile.api.models.GetV1MeNotifications200ResponseItemsInner
import id.universe.mobile.api.models.GetV1MeSeats200ResponseSeatsInner
import id.universe.mobile.api.models.GetV1MeShift200ResponseShift
import id.universe.mobile.api.models.GetV1MeShift200ResponseShiftFtw
import id.universe.mobile.api.models.GetV1MeShift200ResponseShiftGates
import id.universe.mobile.api.models.GetV1MeShift200ResponseShiftSeat
import id.universe.mobile.api.models.GetV1MobileVersion200Response
import id.universe.mobile.api.models.GetV1Roster200ResponseInner
import id.universe.mobile.api.models.GetV1RosterByIdDays200Response
import id.universe.mobile.api.models.PostV1AuthLogin200ResponsePermissions
import id.universe.mobile.api.models.PostV1AuthLogin200ResponsePrincipal

/*
 * The generated client names its models after the route that returns them
 * (`apps/mobile/openapi.json` has no named schemas). The app speaks of them
 * by what they are.
 */

typealias MyShift = GetV1MeShift200ResponseShift
typealias MyShiftSeat = GetV1MeShift200ResponseShiftSeat
typealias MyShiftFtw = GetV1MeShift200ResponseShiftFtw
typealias MyShiftGates = GetV1MeShift200ResponseShiftGates
typealias PastSeat = GetV1MeSeats200ResponseSeatsInner
typealias Notice = GetV1MeNotifications200ResponseItemsInner
typealias FtwRow = GetV1FitToWork200ResponseRowsInner
typealias AttendanceRow = GetV1Attendance200ResponseRowsInner
typealias Employee = GetV1EmployeesByNik200Response
typealias RosterDocument = GetV1Roster200ResponseInner
typealias RosterDays = GetV1RosterByIdDays200Response
typealias VersionInfo = GetV1MobileVersion200Response
typealias Principal = PostV1AuthLogin200ResponsePrincipal
typealias Permissions = PostV1AuthLogin200ResponsePermissions
