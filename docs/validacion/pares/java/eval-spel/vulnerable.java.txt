import org.springframework.expression.ExpressionParser;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.web.bind.annotation.*;

@RestController
public class ReglaController {
    private final ExpressionParser parser = new SpelExpressionParser();

    @GetMapping("/regla")
    public Object evaluar(@RequestParam String regla) {
        return parser.parseExpression(regla).getValue();
    }
}
